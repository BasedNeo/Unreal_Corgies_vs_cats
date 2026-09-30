extends Node3D
## World (lane G-WORLD, Wave 12): The Lot, built at run time from res://data/the_lot.json + the_lot_heights.bin
## (exported from the TypeScript world by tools/godot/export-lot.mjs: same seed, same numbers as the web game and the
## sim) and the six shared kit GLBs in ../../assets/masters (loaded with GLTFDocument: one source of truth, no copies).
##
## What it makes (groups per engines/godot/README.md; physics layer 1):
##   Ground     MeshInstance3D (group `ground`), the sim's heightfield: same samples, same b-c diagonal split,
##              collided by a HeightMapShape3D on a StaticBody3D (group `world_static`)
##   Colliders  StaticBody3D (group `world_static`): the sim's boxes (Euler YXZ) and cylinders, one shape each
##   Kit        one MultiMeshInstance3D per kit piece (group `kit`): its LOD0 mesh with Godot's automatic mesh LODs,
##              instanced at the web's ?kit=glb placements; they cast no shadow of their own. KitShadow: every loaded
##              piece's LOD0 baked at its placements into one shadows-only mesh (P-GLB4's contract: 1 draw per piece plus
##              one shared shadow draw). COL_ nodes are never instanced: only the <name>_LOD0 mesh is read.
##   Prims      the rest of the procedural props merged into one mesh (group `prims`), vertex colour = palette colour
##              (linear), UV2 = (roughness, metallic) from the palette; a piece whose GLB fails keeps its procedural
##              stand-in here
##   Water      the ditch's water planes (group `water`); fence runs are boxes in Prims
##   Nav        NavigationRegion3D baked from the `world_static` colliders (agent r 0.5 m, h 1 m, climb 0.45 m, 48 deg)
## The build is synchronous in _ready (deterministic; `timings` holds ms per stage); `built` is emitted deferred, so
## nodes whose _ready runs after the world's can still connect to it. `is_built` says whether it has already fired.
## Debug args (after `--`): --no-kit (the procedural stand-ins instead of the GLBs, for A/B), --world-stats (prints
## draw calls, objects and primitives two frames before --frames), --mesh-lod-threshold <px>, --no-nav (skip the bake).
signal built

const DATA_JSON := "res://data/the_lot.json"
const WORLD_LAYER := 1
## Nav voxels: 0.5 m across (the sim's own bot grid is 1 m: src/sim/ai/nav.ts NAV_CELL; 0.25 m took 2.2 s to bake)
## and 0.05 m high, so the climb (the KCC's 0.45 m autostep) and the height (1 m) are whole voxels (Recast floors
## the climb: at 0.15 m, 0.45 / 0.15 = 2.99999 became 0.3 m).
const NAV_CELL := 0.5
const NAV_CELL_H := 0.05
const NAV_AGENT := {"radius": 0.5, "height": 1.0, "climb": 0.45, "slope": 48.0}

var data: Dictionary = {}
var is_built := false
## ms per build stage, and "total".
var timings := {}
var kit_loaded: PackedStringArray = []
var kit_failed: PackedStringArray = []
## piece name -> MultiMeshInstance3D
var kit_nodes := {}
## piece name -> its instance transforms (a CPU copy: headless, the dummy RenderingServer keeps none)
var kit_xforms := {}
## piece name -> number of LOD index arrays Godot generated for its mesh (besides LOD0)
var kit_lods := {}
var use_kit := true
var use_nav := true

var _heights := PackedFloat32Array()
var _nav: NavigationRegion3D
var _ground_body: StaticBody3D
var _colliders: StaticBody3D
var _spawns := {0: [] as Array[Vector3], 1: [] as Array[Vector3]}
var _fallback: Array = []
var _stats_at := -1
var _frame := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	use_kit = not args.has("--no-kit")
	use_nav = not args.has("--no-nav")
	for i in args.size():
		if args[i] == "--world-stats":
			var f := args.find("--frames")
			_stats_at = (int(args[f + 1]) if f >= 0 and f + 1 < args.size() else 90) - 2
		elif args[i] == "--mesh-lod-threshold" and i + 1 < args.size():
			get_viewport().mesh_lod_threshold = float(args[i + 1])
	set_process(_stats_at > 0)
	var t0 := Time.get_ticks_usec()
	_stage("data", _load_data)
	if data.is_empty():
		push_error("World: %s missing or unreadable" % DATA_JSON)
		return
	_stage("terrain", _build_terrain)
	_stage("colliders", _build_colliders)
	_stage("kit", _build_kit)
	_stage("prims", _build_prims)
	_stage("water", _build_water)
	if use_nav:
		_stage("nav", _bake_nav)
	timings["total"] = (Time.get_ticks_usec() - t0) / 1000.0
	is_built = true
	print("WORLD The Lot seed %d built in %.1f ms %s; kit %d/6 loaded%s" % [int(data.seed), timings.total, _fmt_timings(), kit_loaded.size(), "" if kit_failed.is_empty() else " (failed: %s)" % ", ".join(kit_failed)])
	built.emit.call_deferred()


## Contract for game/ and look/ (engines/godot/README.md).
func spawn_points(team: int) -> Array[Vector3]:
	return _spawns.get(team, [] as Array[Vector3])


func slab() -> Dictionary:
	var s: Dictionary = data.get("slab", {})
	if s.is_empty():
		return {"center": Vector3.ZERO, "size": Vector2(8, 8)}
	return {"center": _v3(s.center), "size": Vector2(s.size[0], s.size[1])}


func floodlights() -> Array:
	var out := []
	for f in data.get("floodlights", []):
		out.append({"pos": _v3(f.pos), "target": _v3(f.target), "id": f.id, "team": int(f.team)})
	return out


func nav_region() -> NavigationRegion3D:
	return _nav


## True once the navigation map serves the baked mesh: the region syncs on the NavigationServer's own iterations,
## about 10 physics frames after `built` (bots can also wait for NavigationServer3D.map_changed).
func nav_ready() -> bool:
	if _nav == null or _spawns[0].is_empty():
		return false
	var map := _nav.get_navigation_map()
	if NavigationServer3D.map_get_iteration_id(map) == 0:
		return false
	var s: Vector3 = _spawns[0][0]
	return NavigationServer3D.map_get_closest_point(map, s).distance_to(s) < 1.0


## Spawn facings (radians about +Y, the sim's yaw), parallel to spawn_points(team).
func spawn_yaws(team: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for s in data.get("spawns", {}).get(str(team), []):
		out.append(s[3])
	return out


## The sim's ground height at (x, z) (the triangulated grid, b-c split), for callers that want it without a ray.
func ground_height(x: float, z: float) -> float:
	var t: Dictionary = data.terrain
	var n := int(t.n)
	var u := clampf((x - t.x0) / t.cell, 0.0, n - 1 - 1e-6)
	var v := clampf((z - t.z0) / t.cell, 0.0, n - 1 - 1e-6)
	var i := int(u)
	var j := int(v)
	var fx := u - i
	var fz := v - j
	var a := _heights[j * n + i]
	var b := _heights[j * n + i + 1]
	var c := _heights[(j + 1) * n + i]
	var d := _heights[(j + 1) * n + i + 1]
	return a + (b - a) * fx + (c - a) * fz if fx + fz <= 1.0 else d + (c - d) * (1.0 - fx) + (b - d) * (1.0 - fz)


# ------------------------------------------------------------------------------------------------ build stages
func _stage(name: String, f: Callable) -> void:
	var t := Time.get_ticks_usec()
	f.call()
	timings[name] = (Time.get_ticks_usec() - t) / 1000.0


func _fmt_timings() -> String:
	var parts := []
	for k in timings:
		if k != "total":
			parts.append("%s %.0f" % [k, timings[k]])
	return "(" + ", ".join(parts) + ")"


func _load_data() -> void:
	var text := FileAccess.get_file_as_string(DATA_JSON)
	var parsed = JSON.parse_string(text) if text != "" else null
	if not (parsed is Dictionary):
		return
	data = parsed
	var bytes := FileAccess.get_file_as_bytes(DATA_JSON.get_base_dir().path_join(data.terrain.heights))
	_heights = bytes.to_float32_array()
	var n := int(data.terrain.n)
	if _heights.size() != n * n:
		push_error("World: heights have %d samples, want %d" % [_heights.size(), n * n])
		data = {}
		return
	for team in [0, 1]:
		var pts: Array[Vector3] = []
		for s in data.spawns[str(team)]:
			pts.append(Vector3(s[0], s[1], s[2]))
		_spawns[team] = pts


func _build_terrain() -> void:
	var t: Dictionary = data.terrain
	var n := int(t.n)
	var cell := float(t.cell)
	var x0 := float(t.x0)
	var z0 := float(t.z0)
	var h := _heights
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var uvs := PackedVector2Array()
	verts.resize(n * n)
	norms.resize(n * n)
	uvs.resize(n * n)
	var c2 := 2.0 * cell
	for j in n:
		var row := j * n
		var up := maxi(j - 1, 0) * n
		var dn := mini(j + 1, n - 1) * n
		var z := z0 + j * cell
		for i in n:
			var k := row + i
			var x := x0 + i * cell
			verts[k] = Vector3(x, h[k], z)
			norms[k] = Vector3(h[row + maxi(i - 1, 0)] - h[row + mini(i + 1, n - 1)], c2, h[up + i] - h[dn + i])
			uvs[k] = Vector2(x, z)
	# the sim's split (terrain.ts gridHeight): a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1) -> (a,b,c) (b,d,c), clockwise
	# seen from above, which is Godot's front face
	var m := n - 1
	var idx := PackedInt32Array()
	idx.resize(m * m * 6)
	var q := 0
	for j in m:
		var a := j * n
		for i in m:
			idx[q] = a
			idx[q + 1] = a + 1
			idx[q + 2] = a + n
			idx[q + 3] = a + 1
			idx[q + 4] = a + n + 1
			idx[q + 5] = a + n
			q += 6
			a += 1
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.29, 0.24, 0.19)
	mat.roughness = 0.9
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Ground"
	mi.mesh = mesh
	mi.add_to_group("ground")
	add_child(mi)
	# collision: the same samples; HeightMapShape3D is centred on its node, samples 1 m apart (the grid's cell)
	_ground_body = StaticBody3D.new()
	_ground_body.name = "GroundBody"
	_ground_body.collision_layer = WORLD_LAYER
	_ground_body.collision_mask = 0
	_ground_body.add_to_group("world_static")
	var shape := HeightMapShape3D.new()
	shape.map_width = n
	shape.map_depth = n
	shape.map_data = h
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position = Vector3(x0 + m * cell / 2.0, 0, z0 + m * cell / 2.0)
	if not is_equal_approx(cell, 1.0):
		cs.scale = Vector3(cell, 1, cell)
	_ground_body.add_child(cs)
	add_child(_ground_body)


func _build_colliders() -> void:
	_colliders = StaticBody3D.new()
	_colliders.name = "Colliders"
	_colliders.collision_layer = WORLD_LAYER
	_colliders.collision_mask = 0
	_colliders.add_to_group("world_static")
	var boxes := {}
	for b in data.colliders.boxes:
		var size := Vector3(b[4], b[5], b[6]) * 2.0
		var key := str(size)
		if not boxes.has(key):
			var s := BoxShape3D.new()
			s.size = size
			boxes[key] = s
		var cs := CollisionShape3D.new()
		cs.name = "%s_%d" % [b[0], _colliders.get_child_count()]
		cs.shape = boxes[key]
		cs.transform = Transform3D(Basis.from_euler(Vector3(b[8], b[7], b[9]), EULER_ORDER_YXZ), Vector3(b[1], b[2], b[3]))
		_colliders.add_child(cs)
	for c in data.colliders.cylinders:
		var s := CylinderShape3D.new()
		s.radius = c[4]
		s.height = c[5] * 2.0
		var cs := CollisionShape3D.new()
		cs.name = "%s_%d" % [c[0], _colliders.get_child_count()]
		cs.shape = s
		cs.position = Vector3(c[1], c[2], c[3])
		_colliders.add_child(cs)
	add_child(_colliders)


## Loads every kit piece's GLB and instances it; a piece that does not load leaves its procedural stand-in in
## _fallback (drawn with the prims).
func _build_kit() -> void:
	if not use_kit:
		for p in data.kit:
			_fallback.append_array(p.fallbackPrims)
		return
	var root := Node3D.new()
	root.name = "Kit"
	add_child(root)
	var sv := PackedVector3Array()
	var sn := PackedVector3Array()
	# the six GLB reads (mostly PNG decoding) run in parallel; everything after them stays on this thread, in order
	_gltf.resize(data.kit.size())
	var task := WorkerThreadPool.add_group_task(_read_gltf, data.kit.size(), -1, true, "world kit")
	WorkerThreadPool.wait_for_group_task_completion(task)
	for pi in data.kit.size():
		var p: Dictionary = data.kit[pi]
		var piece := _load_piece(p, _gltf[pi])
		if piece.is_empty():
			kit_failed.append(p.name)
			_fallback.append_array(p.fallbackPrims)
			push_warning("World: %s did not load; its procedural stand-in is drawn" % p.name)
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = bool(p.paintTint)
		mm.mesh = piece.mesh
		mm.instance_count = p.placements.size()
		var xfs: Array[Transform3D] = []
		for i in p.placements.size():
			var xf: Transform3D = _placement(p.placements[i]) * piece.xf
			mm.set_instance_transform(i, xf)
			xfs.append(xf)
			if mm.use_colors:
				mm.set_instance_color(i, Color(p.placements[i][6], p.placements[i][7], p.placements[i][8]))
			sv.append_array(xf * (piece.tris[0] as PackedVector3Array))
			sn.append_array(Transform3D(xf.basis.inverse().transposed(), Vector3.ZERO) * (piece.tris[1] as PackedVector3Array))
		var mmi := MultiMeshInstance3D.new()
		mmi.name = p.name
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.add_to_group("kit")
		root.add_child(mmi)
		kit_nodes[p.name] = mmi
		kit_xforms[p.name] = xfs
		kit_loaded.append(p.name)
	if not sv.is_empty():
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = sv
		arrays[Mesh.ARRAY_NORMAL] = sn
		var sm := ArrayMesh.new()
		sm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var caster := MeshInstance3D.new()
		caster.name = "KitShadow"
		caster.mesh = sm
		var m := StandardMaterial3D.new()
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		caster.material_override = m
		caster.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		root.add_child(caster)


var _gltf: Array = []


## Worker: reads kit piece i's GLB into _gltf[i] (a GLTFState, or null when the file is missing or broken).
func _read_gltf(i: int) -> void:
	var path := ProjectSettings.globalize_path("res://").path_join("../..").path_join(data.kit[i].glb).simplify_path()
	var st := GLTFState.new()
	_gltf[i] = st if FileAccess.file_exists(path) and GLTFDocument.new().append_from_file(path, st) == OK else null


## One piece: its <name>_LOD0 mesh read from the GLTF state (CPU data; COL_ nodes and LOD1/2 are never instanced),
## with Godot's automatic LODs generated on it. {} when the file is missing or broken.
func _load_piece(p: Dictionary, st: GLTFState) -> Dictionary:
	if st == null:
		return {}
	var nodes := st.get_nodes()
	var want: String = p.name + "_LOD0"
	var at := -1
	for i in nodes.size():
		var nm: String = nodes[i].original_name if nodes[i].original_name != "" else nodes[i].resource_name
		if nm == want and nodes[i].mesh >= 0:
			at = i
			break
	if at < 0:
		return {}
	var xf := Transform3D.IDENTITY
	var k := at
	while k >= 0:
		xf = nodes[k].xform * xf
		k = nodes[k].parent
	var im: ImporterMesh = st.get_meshes()[nodes[at].mesh].mesh
	if im == null or im.get_surface_count() == 0:
		return {}
	var src := im.get_surface_arrays(0)
	var tris := _deindex(src[Mesh.ARRAY_VERTEX], src[Mesh.ARRAY_NORMAL], src[Mesh.ARRAY_INDEX])
	var mat: Material = im.get_surface_material(0)
	if bool(p.paintTint) and mat is BaseMaterial3D:
		# the placement's palette colour: until look/ has a paint-mask shader, the tint covers the whole albedo
		mat = mat.duplicate()
		mat.vertex_color_use_as_albedo = true
		im.set_surface_material(0, mat)
	im.generate_lods(25.0, 60.0, [])
	var mesh := im.get_mesh()
	kit_lods[p.name] = im.get_surface_lod_count(0)
	return {"mesh": mesh, "tris": tris, "xf": xf}


## A kit placement row [x, y, z, yaw, pitch, sz, ...] -> T(x, y, z) Ry(yaw) Rx(pitch) S(1, 1, sz) (kit-glb.ts).
func _placement(r: Array) -> Transform3D:
	var basis := Basis.from_euler(Vector3(r[4], r[3], 0), EULER_ORDER_YXZ) * Basis.from_scale(Vector3(1, 1, r[5]))
	return Transform3D(basis, Vector3(r[0], r[1], r[2]))


# ------------------------------------------------------------------------------------------------ prims
var _unit_cache := {}


## De-indexed triangles (vertex, normal) of a prim's shape at unit size (or its own size for rings), and its scale.
func _unit(s: String, a: float, b: float, c: float, seg: int) -> Array:
	var key := s
	var scale := Vector3(a, b, c)
	var pm: PrimitiveMesh = null
	match s:
		"box":
			pm = BoxMesh.new()
		"cyl", "cone":
			var top := 0.0 if s == "cone" else a / maxf(c, 1e-4)
			var r := c if s == "cyl" else a
			key = "cyl|%.3f|%d" % [top, seg]
			scale = Vector3(r, b, r)
			if not _unit_cache.has(key):
				var cm := CylinderMesh.new()
				cm.top_radius = top
				cm.bottom_radius = 1.0
				cm.height = 1.0
				cm.radial_segments = seg if seg > 0 else (12 if s == "cone" else 14)
				cm.rings = 0
				pm = cm
		"sphere":
			key = "sphere|%d" % seg
			if not _unit_cache.has(key):
				var sm := SphereMesh.new()
				var n := seg if seg > 0 else 12
				sm.radial_segments = n
				sm.rings = maxi(5, roundi(n * 0.65))
				pm = sm
		"ring":
			key = "ring|%.4f|%.4f|%.4f|%d" % [a, b, c, seg]
			scale = Vector3.ONE
			if not _unit_cache.has(key):
				_unit_cache[key] = _ring(a, b, c, seg if seg > 0 else 32)
		_:
			key = "box"
			pm = BoxMesh.new()
	if not _unit_cache.has(key):
		var arr := pm.get_mesh_arrays()
		_unit_cache[key] = _deindex(arr[Mesh.ARRAY_VERTEX], arr[Mesh.ARRAY_NORMAL], arr[Mesh.ARRAY_INDEX])
	var u: Array = _unit_cache[key]
	return [u[0], u[1], Vector3(maxf(scale.x, 1e-4), maxf(scale.y, 1e-4), maxf(scale.z, 1e-4))]


## [vertices, normals] of an indexed triangle list, one vertex per corner (no index to offset when merging).
func _deindex(v: PackedVector3Array, nn: PackedVector3Array, idx: PackedInt32Array) -> Array:
	if idx.is_empty():
		return [v, nn]
	var dv := PackedVector3Array()
	var dn := PackedVector3Array()
	dv.resize(idx.size())
	dn.resize(idx.size())
	for i in idx.size():
		dv[i] = v[idx[i]]
		dn[i] = nn[idx[i]]
	return [dv, dn]


## A thick open tube along +Y (prim-mesh.ts 'ring', without the edge chamfers): outer and inner walls, two annuli.
func _ring(ro: float, hgt: float, wall: float, seg: int) -> Array:
	var ri := ro - wall
	var h := hgt / 2.0
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	for k in seg:
		var a0 := TAU * k / seg
		var a1 := TAU * (k + 1) / seg
		var d0 := Vector3(sin(a0), 0, cos(a0))
		var d1 := Vector3(sin(a1), 0, cos(a1))
		_quad(v, n, d0 * ro + Vector3.DOWN * h, d1 * ro + Vector3.DOWN * h, d1 * ro + Vector3.UP * h, d0 * ro + Vector3.UP * h, (d0 + d1).normalized())
		_quad(v, n, d0 * ri + Vector3.DOWN * h, d1 * ri + Vector3.DOWN * h, d1 * ri + Vector3.UP * h, d0 * ri + Vector3.UP * h, -(d0 + d1).normalized())
		_quad(v, n, d0 * ri + Vector3.UP * h, d1 * ri + Vector3.UP * h, d1 * ro + Vector3.UP * h, d0 * ro + Vector3.UP * h, Vector3.UP)
		_quad(v, n, d0 * ri + Vector3.DOWN * h, d1 * ri + Vector3.DOWN * h, d1 * ro + Vector3.DOWN * h, d0 * ro + Vector3.DOWN * h, Vector3.DOWN)
	return [v, n]


## Two triangles facing `nrm` (Godot's front face: clockwise seen from the normal's side).
func _quad(v: PackedVector3Array, n: PackedVector3Array, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, nrm: Vector3) -> void:
	for t in [[p0, p1, p2], [p0, p2, p3]]:
		if (t[1] - t[0]).cross(t[2] - t[0]).dot(nrm) > 0.0:
			t = [t[0], t[2], t[1]]
		v.append_array(PackedVector3Array(t))
		n.append_array(PackedVector3Array([nrm, nrm, nrm]))


func _build_prims() -> void:
	var rows: Array = data.prims.duplicate()
	rows.append_array(_fallback)
	# fence runs (drawn by the web's fence view, not as prims): one board wall each, on the ground
	for f in data.fences:
		var mx: float = (f.x0 + f.x1) / 2.0
		var mz: float = (f.z0 + f.z1) / 2.0
		var gy := ground_height(mx, mz)
		var length := Vector2(f.x1 - f.x0, f.z1 - f.z0).length()
		rows.append(["box", mx, gy + (f.h - 0.5) / 2.0, mz, 0.12, f.h + 0.5, length, atan2(f.x1 - f.x0, f.z1 - f.z0), 0, 0, "fenceWood", 0, 0])
	var pal := {}
	for k in data.palette:
		var e: Dictionary = data.palette[k]
		pal[k] = [Color.html(e.hex).srgb_to_linear(), Vector2(e.rough, e.metal)]
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var rm := PackedVector2Array()
	for r in rows:
		var u := _unit(r[0], r[4], r[5], r[6], int(r[11]))
		var basis := Basis.from_euler(Vector3(r[8], r[7], r[9]), EULER_ORDER_YXZ) * Basis.from_scale(u[2])
		verts.append_array(Transform3D(basis, Vector3(r[1], r[2], r[3])) * (u[0] as PackedVector3Array))
		norms.append_array(Transform3D(basis.inverse().transposed(), Vector3.ZERO) * (u[1] as PackedVector3Array))
		var m: int = u[0].size()
		var p: Array = pal.get(r[10], [Color(0.5, 0.5, 0.5), Vector2(0.8, 0.0)])
		var cc := PackedColorArray()
		cc.resize(m)
		cc.fill(p[0])
		cols.append_array(cc)
		var rr := PackedVector2Array()
		rr.resize(m)
		rr.fill(p[1])
		rm.append_array(rr)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_TEX_UV2] = rm
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.8
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Prims"
	mi.mesh = mesh
	mi.add_to_group("prims")
	add_child(mi)


func _build_water() -> void:
	if data.water.is_empty():
		return
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_normal(Vector3.UP)
	for w in data.water:
		var y: float = w.surfaceY
		var a := Vector3(w.x - w.hx, y, w.z - w.hz)
		var b := Vector3(w.x + w.hx, y, w.z - w.hz)
		var c := Vector3(w.x - w.hx, y, w.z + w.hz)
		var d := Vector3(w.x + w.hx, y, w.z + w.hz)
		for p in [a, b, c, b, d, c]:
			st.add_vertex(p)
	var mi := MeshInstance3D.new()
	mi.name = "Water"
	mi.mesh = st.commit()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.2, 0.17, 0.12, 0.8)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 0.05
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.add_to_group("water")
	add_child(mi)


# ------------------------------------------------------------------------------------------------ navigation
func _bake_nav() -> void:
	var nm := NavigationMesh.new()
	nm.cell_size = NAV_CELL
	nm.cell_height = NAV_CELL_H
	nm.agent_radius = NAV_AGENT.radius
	nm.agent_height = NAV_AGENT.height
	nm.agent_max_climb = NAV_AGENT.climb
	nm.agent_max_slope = NAV_AGENT.slope
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nm.geometry_collision_mask = WORLD_LAYER
	nm.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_GROUPS_WITH_CHILDREN
	nm.geometry_source_group_name = "world_static"
	var b: Dictionary = data.bounds
	nm.filter_baking_aabb = AABB(Vector3(b.minX, data.killY, b.minZ), Vector3(b.maxX - b.minX, 60.0 - data.killY, b.maxZ - b.minZ))
	var src := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(nm, src, self)
	NavigationServer3D.bake_from_source_geometry_data(nm, src)
	var map := get_world_3d().navigation_map
	NavigationServer3D.map_set_cell_size(map, NAV_CELL)
	NavigationServer3D.map_set_cell_height(map, NAV_CELL_H)
	_nav = NavigationRegion3D.new()
	_nav.name = "Nav"
	_nav.navigation_mesh = nm
	add_child(_nav)


# ------------------------------------------------------------------------------------------------ debug stats
func _process(_d: float) -> void:
	_frame += 1
	if _frame != _stats_at:
		return
	var rs := RenderingServer
	print("WORLD stats kit=%s draws=%d objects=%d primitives=%d mesh_lod_threshold=%.2f kit_lods=%s adapter=%s" % [
		"on" if use_kit else "off",
		rs.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		rs.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		rs.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		get_viewport().mesh_lod_threshold, str(kit_lods), rs.get_video_adapter_name()])


func _v3(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])

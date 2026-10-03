extends SceneTree
## W15 p-art: the character-sheet reference rig. NOT part of the game: nothing in the game loads this file.
## It builds each PLACEHOLDER pet exactly as the match does (game/pet.gd: the merged model from game/pet_model.gd and
## the rifle from game/rifle.gd at pet.gd's mount point), then renders it on a plain mid-grey backdrop under even,
## neutral studio light from fixed orthographic views. The renders are the proportion and placement guide (and the
## image-to-image condition) for the generated character reference sheets in assets/incoming/w15-char-refs/.
## - Corgi: species 0, team 0 (Corgi Company). Cat: species 1, team 1 (Cat Cadre).
## - Views (the pet faces -Z; its right side, where the rifle rides, is +X): front, left, right, back, threequarter
##   (front-right, 40 deg round and 12 deg up, so the rifle shows), top (head up); plus lineup_side (both pets side on
##   at one scale). One orthographic scale per species across its views, so the views line up like a turnaround
##   (<species>_<view>.png, square). Each view is also framed tight on the pet at the aspect that suits it
##   (<species>_<view>_fit.png: 4:3 side on and three-quarter, 3:4 front, back and top), the image-to-image inputs;
##   and a turnaround strip (<species>_turnaround.png, 5:2: front, right side, back at one scale).
## - Materials: the look's own pet materials (look/pet_materials.gd: coat and fur texture, team band, rifle metal)
##   with the night-only terms removed (self-lit fill, rim sheen, clearcoat); the trim (`plate`) is plain ochre
##   (no scuff or team-band texture).
## Run from the repo root (a real renderer: the headless dummy renderer cannot save images):
##   xvfb-run -a -s "-screen 0 1280x720x24" $G --path engines/godot --rendering-method gl_compatibility \
##     --rendering-driver opengl3 --audio-driver Dummy --script res://tools/ref_rig.gd [-- --out <dir>] [--size <px>]
## Writes <out>/<species>_<view>[_fit].png and <out>/rig.json (the cameras, the measured extents and the proportions the
## sheets must keep). The default out is $TMPDIR/w15-ref-rig (else /tmp/w15-ref-rig); the committed set in
## assets/incoming/w15-char-refs/condition is rewritten only with an explicit --out naming it. Exit 0 when every image
## saved. Measured byte-identical on rerun with Godot 4.7.2 Compatibility on Mesa 25.2.8 llvmpipe (LLVM 20.1.2); another
## GPU, driver or Godot version will rasterise differently.

const Pet := preload("res://game/pet.gd")
const PetMaterials := preload("res://look/pet_materials.gd")
const T := preload("res://game/tuning.gd")

const PETS := [{"name": "corgi", "species": 0, "team": 0}, {"name": "cat", "species": 1, "team": 1}]
## view -> [azimuth deg (0: in front of the pet, facing its face; +90: its right side), elevation deg, fit aspect w/h]
const VIEWS := {
	"front": [0.0, 0.0, 0.75],
	"left": [-90.0, 0.0, 4.0 / 3.0],
	"right": [90.0, 0.0, 4.0 / 3.0],
	"back": [180.0, 0.0, 0.75],
	"threequarter": [40.0, 12.0, 4.0 / 3.0],
	"top": [0.0, 90.0, 0.75],
}
const BACKDROP := Color(0.5, 0.5, 0.5)  # plain mid-grey (sRGB 128)
const MARGIN := 1.18  # turnaround frame = the largest extent of the pet over all its views x this
const FIT_MARGIN := 1.12  # fit frame = this view's extent x this
const WATCHDOG_S := 120.0

var _out := ""
var _size := 1024
var _vp: SubViewport
var _cam: Camera3D
var _lights: Array[DirectionalLight3D] = []
var _look: Node
var _saved := 0
var _failed := 0
var _report := {"pets": {}, "views": VIEWS, "backdrop_srgb": [0.5, 0.5, 0.5], "projection": "orthographic"}


## The look for the rig: the game's pet materials under studio light (no night-only terms).
class StudioLook extends Node:
	var _pm := PetMaterials.new()
	var _cache := {}

	func _init() -> void:
		_pm.forward_plus = false

	func pet_material(kind: String, species: int, team: int) -> Material:
		var key := "%s_%d_%d" % [kind, species, team]
		if _cache.has(key):
			return _cache[key]
		var m: StandardMaterial3D
		if kind == "plate":
			m = StandardMaterial3D.new()  # the ochre trim, plain (the look's plate texture paints a team band on it)
			m.albedo_color = PetMaterials.OCHRE
			m.roughness = 0.45
			m.metallic = 0.15
		else:
			m = (_pm.get_material(kind, species, team) as StandardMaterial3D).duplicate() as StandardMaterial3D
			m.emission_enabled = false  # the night's self-lit readability fill
			m.rim_enabled = false  # the wet sheen along the silhouette
			m.clearcoat_enabled = false
		m.resource_name = "ref_rig_" + key
		_cache[key] = m
		return m


func _init() -> void:
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(WATCHDOG_S, true, false, true).timeout
	print("REF_RIG FAIL watchdog: not done in %d s" % int(WATCHDOG_S))
	quit(1)


## The output dir: `--out <dir>` (relative paths are from the repo root), else a temp dir. The committed renders in the
## repo's condition/ dir are written only when --out names that dir: a default run never overwrites them.
func _args() -> bool:
	var a := OS.get_cmdline_user_args()
	var named := false
	for i in a.size():
		if a[i] == "--out" and i + 1 < a.size():
			_out = a[i + 1]
			named = true
		elif a[i] == "--size" and i + 1 < a.size():
			_size = clampi(int(a[i + 1]), 256, 2048)
	var repo := ProjectSettings.globalize_path("res://").path_join("../..").simplify_path()
	if _out == "":
		var tmp := OS.get_environment("TMPDIR")
		_out = (tmp if tmp != "" else "/tmp").path_join("w15-ref-rig")
	elif not _out.is_absolute_path():
		_out = repo.path_join(_out)
	_out = _out.simplify_path()
	var committed := repo.path_join("assets/incoming/w15-char-refs/condition").simplify_path()
	if _out.trim_suffix("/") == committed and not named:
		print("REF_RIG REFUSED: will not write into %s unless --out names it" % committed)
		return false
	DirAccess.make_dir_recursive_absolute(_out)
	return true


func _run() -> void:
	_watchdog()
	if not _args():
		quit(2)
		return
	print("REF_RIG renderer=%s adapter=%s out=%s" % [RenderingServer.get_current_rendering_method(),
		RenderingServer.get_video_adapter_name(), _out])
	_stage()
	for p in PETS:
		await _render_pet(p)
		await _render_turnaround(p)
	await _render_lineup()
	_report["size_px"] = _size
	var f := FileAccess.open(_out.path_join("rig.json"), FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(_report, "  ", false))
		f.close()
	print("REF_RIG done: %d saved, %d failed" % [_saved, _failed])
	quit(0 if _failed == 0 and _saved > 0 else 1)


## The studio: one SubViewport with its own world (square, resized for the fit and turnaround frames), a plain grey
## background, neutral ambient, linear tonemap, three directional lights (key, fill, rim) that follow the camera so every
## view is lit the same way.
func _stage() -> void:
	_vp = SubViewport.new()
	_vp.size = Vector2i(_size, _size)
	_vp.own_world_3d = true
	_vp.msaa_3d = Viewport.MSAA_4X
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(_vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = BACKDROP
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(1, 1, 1)
	env.ambient_light_energy = 0.3
	env.reflected_light_source = Environment.REFLECTION_SOURCE_BG
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	var we := WorldEnvironment.new()
	we.environment = env
	_vp.add_child(we)
	_cam = Camera3D.new()
	_cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	_cam.keep_aspect = Camera3D.KEEP_HEIGHT
	_cam.near = 0.05
	_cam.far = 60.0
	_vp.add_child(_cam)
	_cam.current = true
	for e in [0.8, 0.32, 0.45]:  # key, fill, rim
		var l := DirectionalLight3D.new()
		l.light_energy = e
		l.light_color = Color(1, 1, 1)
		l.light_specular = 0.5
		_vp.add_child(l)
		_lights.append(l)
	_lights[0].shadow_enabled = true
	_lights[0].shadow_opacity = 0.55
	_lights[0].shadow_blur = 2.0
	_look = StudioLook.new()
	_vp.add_child(_look)


## A pet as the match makes one (untyped: pet.gd's members are read below).
func _spawn(p: Dictionary, at := Vector3.ZERO):
	var pet = Pet.new()
	pet.configure(int(p.team), int(p.species), "ref_" + String(p.name), _look)
	pet.position = at
	_vp.add_child(pet)  # _ready: the collider, the merged model and the rifle at its mount, as in the match
	pet.set_facing(0.0, 0.0)  # face -Z, rifle level
	return pet


## Every corner of every mesh at or under `n` (model and rifle; the rifle's hidden FX are skipped), in world space.
func _corners(n: Node) -> PackedVector3Array:
	var pts := PackedVector3Array()
	var meshes: Array = n.find_children("*", "MeshInstance3D", true, false)
	if n is MeshInstance3D:
		meshes.append(n)
	for g in meshes:
		var mi := g as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree():
			continue
		var box: AABB = mi.global_transform * mi.get_aabb()
		for i in 8:
			pts.append(box.get_endpoint(i))
	return pts


func _box(pts: PackedVector3Array) -> AABB:
	var b := AABB(pts[0], Vector3.ZERO)
	for q in pts:
		b = b.expand(q)
	return b


## The camera basis for a view: [back (towards the camera), right, up].
func _axes(view: Array) -> Array:
	var az := deg_to_rad(float(view[0]))
	var el := deg_to_rad(float(view[1]))
	if absf(float(view[1])) >= 89.0:  # top: look straight down, the head (-Z) at the top of the frame
		return [Vector3.UP, Vector3.RIGHT, Vector3.FORWARD]
	var back := Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)).normalized()
	var right := Vector3.UP.cross(back).normalized()
	var up := back.cross(right).normalized()
	return [back, right, up]


func _place(view: Array, center: Vector3, size: float, offset := Vector2.ZERO) -> void:
	var ax := _axes(view)
	var back: Vector3 = ax[0]
	var right: Vector3 = ax[1]
	var up: Vector3 = ax[2]
	_cam.size = size
	_cam.global_transform = Transform3D(Basis(right, up, back), center + right * offset.x + up * offset.y + back * 20.0)
	# key from camera-left and above, fill from camera-right and low, rim from behind and above
	var from := [(back + up * 1.0 - right * 0.75).normalized(), (back + up * 0.15 + right * 1.0).normalized(),
		(-back + up * 0.9 + right * 0.3).normalized()]
	for i in _lights.size():
		var d: Vector3 = -from[i]
		var ref := Vector3.UP if absf(d.dot(Vector3.UP)) < 0.95 else Vector3.FORWARD
		_lights[i].global_transform = Transform3D(Basis.looking_at(d, ref), Vector3.ZERO)


## The largest extent of `pts` over the given views, on the camera's right and up axes.
func _fit(pts: PackedVector3Array, center: Vector3, views: Array) -> float:
	var ext := 0.0
	for v in views:
		var ax := _axes(v)
		var lo := Vector2(INF, INF)
		var hi := Vector2(-INF, -INF)
		for q in pts:
			var r := Vector2((q - center).dot(ax[1]), (q - center).dot(ax[2]))
			lo = lo.min(r)
			hi = hi.max(r)
		# centred on `center`: the frame must hold the farther side of each axis
		ext = maxf(ext, 2.0 * maxf(maxf(absf(lo.x), absf(hi.x)), maxf(absf(lo.y), absf(hi.y))))
	return ext * MARGIN


## One view framed tight: [ortho size (frame height, m), offset of the frame centre on the camera's right / up axes].
func _fit_one(pts: PackedVector3Array, center: Vector3, view: Array, aspect: float) -> Array:
	var ax := _axes(view)
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for q in pts:
		var r := Vector2((q - center).dot(ax[1]), (q - center).dot(ax[2]))
		lo = lo.min(r)
		hi = hi.max(r)
	var ext := hi - lo
	return [maxf(ext.y, ext.x / aspect) * FIT_MARGIN, (lo + hi) * 0.5]


func _shoot(name: String) -> void:
	for i in 4:
		await process_frame
	await RenderingServer.frame_post_draw
	var img := _vp.get_texture().get_image()
	var path := _out.path_join(name + ".png")
	var err := img.save_png(path)
	if err == OK:
		_saved += 1
	else:
		_failed += 1
	print("REF_RIG shot %s (%dx%d) err=%d" % [path, img.get_width(), img.get_height(), err])


func _render_pet(p: Dictionary) -> void:
	var pet = _spawn(p)
	await process_frame
	var pts := _corners(pet)
	var box := _box(pts)
	var model_box := _box(_corners(pet.model.get_node("Body")))  # the pet alone (the rifle is a child of the model)
	var center := box.get_center()
	var size := _fit(pts, center, VIEWS.values())
	var fits := {}
	for v in VIEWS:
		_vp.size = Vector2i(_size, _size)
		_place(VIEWS[v], center, size)
		await _shoot("%s_%s" % [p.name, v])
		var aspect := float(VIEWS[v][2])
		_vp.size = Vector2i(_size, roundi(_size / aspect)) if aspect >= 1.0 else Vector2i(roundi(_size * aspect), _size)
		var f := _fit_one(pts, center, VIEWS[v], aspect)
		_place(VIEWS[v], center, f[0], f[1])
		await _shoot("%s_%s_fit" % [p.name, v])
		fits[v] = {"ortho_size_m": snappedf(f[0], 0.001), "px": [_vp.size.x, _vp.size.y]}
	_vp.size = Vector2i(_size, _size)
	var lay: Dictionary = load("res://game/pet_model.gd").layout(int(p.species), int(p.team))
	var parts: Dictionary = lay.parts
	var body: AABB = parts.body
	var legs: AABB = parts.legs
	var head: AABB = parts.head
	var tail: AABB = parts.tail
	var ear: AABB = parts.ear_l
	_report.pets[p.name] = {
		"species": p.species, "team": p.team, "team_name": T.TEAM_NAMES[int(p.team)],
		"ortho_size_m": snappedf(size, 0.001), "fit_frames": fits,
		"bounds_with_rifle_m": {"min": _v(box.position), "max": _v(box.end)},
		"bounds_pet_only_m": {"min": _v(model_box.position), "max": _v(model_box.end)},
		"capsule_m": {"radius": T.MOVE[int(p.species)].radius, "height": T.height(int(p.species))},
		"rifle_mount_m": _v(pet.rifle.position),
		"body_length_m": snappedf(body.size.z, 0.001), "back_height_m": snappedf(body.end.y, 0.001),
		"body_length_to_back_height": snappedf(body.size.z / body.end.y, 0.01),
		"leg_length_m": snappedf(legs.size.y, 0.001), "head_top_m": snappedf(head.end.y, 0.001),
		"ear_tip_m": snappedf(ear.end.y, 0.001), "ear_height_m": snappedf(ear.size.y, 0.001),
		"head_height_m": snappedf(head.size.y, 0.001), "tail_top_m": snappedf(tail.end.y, 0.001),
		"tallest_point_m": snappedf(model_box.end.y, 0.001),
	}
	pet.queue_free()
	await process_frame


## One species three times in one frame at one scale, seen from the front camera: facing the camera (front), turned to
## show its right side (head to the right) and facing away (back), left to right. A 5:2 frame (a turnaround strip).
func _render_turnaround(p: Dictionary) -> void:
	const GAP := 0.35
	const ASPECT := 2.5
	var yaws := [0.0, PI * 0.5, PI]  # front, right side, back (seen from the camera at -Z)
	var pets := []
	var widths := []
	for y in yaws:
		var pet = _spawn(p)
		pet.set_facing(y, 0.0)
		pets.append(pet)
	await process_frame
	for pet in pets:
		var b := _box(_corners(pet))
		widths.append(b.size.x)
	# screen right is world -X from the front camera: lay the pets out along -X with GAP between their boxes
	var x := 0.0
	for i in pets.size():
		var b := _box(_corners(pets[i]))
		pets[i].position.x = x - b.end.x  # this pet's +X edge sits at x
		x -= float(widths[i]) + GAP
	await process_frame
	var pts := PackedVector3Array()
	for pet in pets:
		pts.append_array(_corners(pet))
	var box := _box(pts)
	_vp.size = Vector2i(_size * 2, roundi(_size * 2 / ASPECT))
	var f := _fit_one(pts, box.get_center(), VIEWS.front, ASPECT)
	_place(VIEWS.front, box.get_center(), f[0], f[1])
	await _shoot("%s_turnaround" % p.name)
	_report.pets[p.name]["turnaround"] = {"ortho_size_m": snappedf(f[0], 0.001), "px": [_vp.size.x, _vp.size.y],
		"panels": ["front", "right", "back"], "gap_m": GAP}
	_vp.size = Vector2i(_size, _size)
	for pet in pets:
		pet.queue_free()
	await process_frame


## Both pets side on (their left sides, heads to the left) at one scale, side by side: the corgi on the left of the
## frame, the cat on the right.
func _render_lineup() -> void:
	var corgi = _spawn(PETS[0], Vector3(0, 0, -1.05))
	var cat = _spawn(PETS[1], Vector3(0, 0, 0.95))
	await process_frame
	var pts := _corners(corgi)
	pts.append_array(_corners(cat))
	var box := _box(pts)
	var size := _fit(pts, box.get_center(), [VIEWS.left])
	_place(VIEWS.left, box.get_center(), size)
	await _shoot("lineup_side")
	_report["lineup_side"] = {"ortho_size_m": snappedf(size, 0.001), "corgi_at": [0, 0, -1.05], "cat_at": [0, 0, 0.95]}
	corgi.queue_free()
	cat.queue_free()
	await process_frame


static func _v(v: Vector3) -> Array:
	return [snappedf(v.x, 0.001), snappedf(v.y, 0.001), snappedf(v.z, 0.001)]

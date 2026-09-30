# validate_glb.gd (W11 P-GLB1): Godot 4 headless check of one shared GLB. Run through tools/godot/run.sh.
#   godot --headless --path tools/godot --script res://validate_glb.gd -- <res://imported.glb> <absolute.glb> [manifest.json]
# Two loads of the same file:
#   import  - the editor-imported scene (ResourceLoader: the pipeline an artist gets; needs `godot --import` first)
#   runtime - GLTFDocument.append_from_file + generate_scene (no editor; what a native client would do at run time)
# For each: prints the node tree, LOD0's AABB in metres, the LOD count and triangles, COL_ count and the materials;
# checks the kit rules (root name, <root>_LOD0|1|2, budgets, COL_ boxes present and material-less, LOD0 on y = 0,
# the manifest size +-5 cm, PBR material with albedo / normal / ORM textures). Exit 0 when the import load passes,
# 1 otherwise. The runtime load is reported (PASS / FAIL) and fails the run only with --strict-runtime.
extends SceneTree

const BUDGETS := [2500, 800, 200]
var failures := 0


func fail(msg: String) -> void:
	failures += 1
	print("  FAIL: ", msg)


func tri_count(mesh: Mesh) -> int:
	var n := 0
	for s in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(s)
		var idx = arrays[Mesh.ARRAY_INDEX]
		n += (idx.size() if idx != null and idx.size() > 0 else arrays[Mesh.ARRAY_VERTEX].size()) / 3
	return n


func print_tree_of(n: Node, depth: int) -> void:
	var extra := ""
	if n is MeshInstance3D and n.mesh:
		extra = "  [%s, %d tris, %d surface(s)]" % [n.get_class(), tri_count(n.mesh), n.mesh.get_surface_count()]
	else:
		extra = "  [%s]" % n.get_class()
	print("  ", "  ".repeat(depth), n.name, extra)
	for c in n.get_children():
		print_tree_of(c, depth + 1)


func find_named(n: Node, name: String) -> Node:
	if String(n.name) == name:
		return n
	for c in n.get_children():
		var r := find_named(c, name)
		if r:
			return r
	return null


func world_xf(n: Node) -> Transform3D:
	# global_transform needs the node in the tree; _initialize runs before the scene tree processes add_child
	var xf := Transform3D.IDENTITY
	var p: Node = n
	while p != null and p is Node3D:
		xf = (p as Node3D).transform * xf
		p = p.get_parent()
	return xf


func collect(n: Node, out: Array) -> void:
	out.append(n)
	for c in n.get_children():
		collect(c, out)


func check(label: String, scene_root: Node, expect_name: String, expect_size) -> int:
	var before := failures
	print("[%s]" % label)
	print_tree_of(scene_root, 0)
	var root := find_named(scene_root, expect_name)
	if root == null:
		fail("no node named %s" % expect_name)
		return failures - before
	var all: Array = []
	collect(root, all)
	var lods := 0
	var cols := 0
	var mats := {}
	for i in 3:
		var lod := find_named(root, "%s_LOD%d" % [expect_name, i])
		if lod == null or not (lod is MeshInstance3D) or lod.mesh == null:
			fail("missing %s_LOD%d mesh" % [expect_name, i])
			continue
		lods += 1
		var tris := tri_count(lod.mesh)
		if tris > BUDGETS[i]:
			fail("LOD%d: %d triangles > %d" % [i, tris, BUDGETS[i]])
		for s in lod.mesh.get_surface_count():
			var m = lod.get_active_material(s)
			if m:
				mats[m] = true
		if i == 0:
			var aabb: AABB = world_xf(lod) * lod.mesh.get_aabb()
			print("  LOD0 AABB (m): position %s size %s end %s" % [aabb.position, aabb.size, aabb.end])
			if absf(aabb.position.y) > 0.01:
				fail("LOD0 bottom at y = %.4f (must be 0)" % aabb.position.y)
			if expect_size != null:
				for k in 3:
					if absf(aabb.size[k] - float(expect_size[k])) > 0.05:
						fail("LOD0 size axis %d = %.3f, manifest %.3f" % [k, aabb.size[k], float(expect_size[k])])
	for n in all:
		if String(n.name).begins_with("COL_"):
			cols += 1
			if n is MeshInstance3D and n.mesh:
				for s in n.mesh.get_surface_count():
					var cm = n.mesh.surface_get_material(s)
					if cm != null and not (cm is StandardMaterial3D and cm.resource_name == ""):
						pass # Godot assigns no material to material-less glTF primitives; a named one is a defect
					if cm != null and cm.resource_name != "":
						fail("%s has material %s" % [n.name, cm.resource_name])
				if tri_count(n.mesh) != 12:
					fail("%s: %d triangles (a box has 12)" % [n.name, tri_count(n.mesh)])
	print("  LODs: %d  COL_: %d  materials: %d" % [lods, cols, mats.size()])
	if cols == 0:
		fail("no COL_ boxes")
	for m in mats.keys():
		if m is BaseMaterial3D:
			var bm: BaseMaterial3D = m
			var t_alb = bm.albedo_texture
			var desc := "  material %s (%s): albedo %s normal %s roughness %s metallic %s ao %s" % [
				bm.resource_name, bm.get_class(),
				("%dx%d" % [t_alb.get_width(), t_alb.get_height()]) if t_alb else "none",
				"yes" if bm.normal_enabled and bm.normal_texture else "no",
				"yes" if bm.roughness_texture else "no",
				"yes" if bm.metallic_texture else "no",
				"yes" if bm.ao_enabled and bm.ao_texture else "no"]
			print(desc)
			if not t_alb or not bm.normal_texture or not bm.roughness_texture or not bm.metallic_texture:
				fail("material %s lacks a PBR texture" % bm.resource_name)
		else:
			print("  material %s (%s)" % [m.resource_name, m.get_class()])
			fail("material is not a BaseMaterial3D")
	print("  %s: %s" % [label, "PASS" if failures == before else "FAIL"])
	return failures - before


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		print("usage: -- <res://file.glb> <absolute file.glb> [manifest.json] [--strict-runtime]")
		quit(2)
		return
	var res_path: String = args[0]
	var abs_path: String = args[1]
	var strict := args.has("--strict-runtime")
	var expect_name := res_path.get_file().get_basename()
	var expect_size = null
	if args.size() > 2 and not args[2].begins_with("--") and FileAccess.file_exists(args[2]):
		var j = JSON.parse_string(FileAccess.get_file_as_string(args[2]))
		if j is Dictionary and j.has("assets"):
			for a in j["assets"]:
				if a.get("name", "") == expect_name and a.has("size_m"):
					expect_size = a["size_m"]
	print("Godot %s  file %s" % [Engine.get_version_info()["string"], abs_path])

	# ---- editor import
	var import_fail := 0
	var packed = load(res_path) if ResourceLoader.exists(res_path) else null
	if packed is PackedScene:
		var inst: Node = packed.instantiate()
		root.add_child(inst)
		import_fail = check("import", inst, expect_name, expect_size)
		inst.queue_free()
	else:
		print("[import]\n  FAIL: %s did not import (see tools/godot/_import/import.log)" % res_path)
		failures += 1
		import_fail = 1

	# ---- runtime GLTFDocument
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(abs_path, state)
	var runtime_fail := 0
	if err != OK:
		print("[runtime]\n  FAIL: GLTFDocument.append_from_file error %d (%s)" % [err, error_string(err)])
		runtime_fail = 1
	else:
		var scene := doc.generate_scene(state)
		if scene == null:
			print("[runtime]\n  FAIL: generate_scene returned null")
			runtime_fail = 1
		else:
			root.add_child(scene)
			var before := failures
			runtime_fail = check("runtime", scene, expect_name, expect_size)
			failures = before  # runtime is reported, not gating, unless --strict-runtime
			scene.queue_free()
	var ok := import_fail == 0 and (runtime_fail == 0 or not strict)
	print("GODOT IMPORT: %s  RUNTIME: %s" % ["PASS" if import_fail == 0 else "FAIL", "PASS" if runtime_fail == 0 else "FAIL"])
	quit(0 if ok else 1)

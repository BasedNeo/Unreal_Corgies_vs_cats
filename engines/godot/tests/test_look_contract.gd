extends RefCounted
## G-LOOK (Wave 12), against a stand-in world (independent of the live Lot): the look waits for World.built, makes one
## floodlight per World.floodlights() entry with shadows on a few, wets `kit` / `prims` materials without replacing
## their maps or touching the originals, and the quality knob turns the costly features off.
const WORLD_SRC := """extends Node3D
signal built
var is_built := false
func floodlights() -> Array:
	return [{"pos": Vector3(0, 22, 0), "target": Vector3(20, 0, 0)}, {"pos": Vector3(40, 22, 0), "target": Vector3(20, 0, 5)},
		{"pos": Vector3(0, 22, 40), "target": Vector3(10, 0, 20)}, {"pos": Vector3(40, 22, 40), "target": Vector3(30, 0, 20)},
		{"pos": Vector3(-40, 22, 0), "target": Vector3(-20, 0, 0)}]
"""

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var ws := GDScript.new()
	ws.source_code = WORLD_SRC
	ws.reload()
	var main := Node3D.new()
	var world: Node3D = ws.new()
	world.name = "World"
	main.add_child(world)
	var ground := MeshInstance3D.new()
	ground.mesh = PlaneMesh.new()
	ground.add_to_group("ground")
	world.add_child(ground)
	var tex := ImageTexture.create_from_image(Image.create(8, 8, false, Image.FORMAT_RGBA8))
	var kit_src := StandardMaterial3D.new()
	kit_src.albedo_texture = tex
	kit_src.roughness = 1.0
	var kit := MeshInstance3D.new()
	kit.mesh = BoxMesh.new()
	kit.mesh.surface_set_material(0, kit_src)
	kit.add_to_group("kit")
	world.add_child(kit)
	var prim_src := StandardMaterial3D.new()
	prim_src.albedo_color = Color(0.5, 0.5, 0.5)
	prim_src.roughness = 0.8
	var prim := MeshInstance3D.new()
	prim.mesh = BoxMesh.new()
	prim.material_override = prim_src
	prim.add_to_group("prims")
	world.add_child(prim)
	var look: Node = load("res://look/look.gd").new()
	look.name = "Look"
	main.add_child(look)
	tree.root.add_child(main)
	await tree.process_frame
	await tree.process_frame
	# not built yet: nothing wetted, no floods
	if kit.get_surface_override_material(0) != null or look.floods.size() != 0:
		errs.append("the look acted before World.built")
	world.is_built = true
	world.built.emit()
	await tree.process_frame
	if look.floods.size() != 5:
		errs.append("%d floods for 5 World.floodlights() entries" % look.floods.size())
	var shadowed := 0
	for s in look.floods:
		shadowed += int(s.shadow_enabled)
		var aim: Vector3 = -s.global_basis.z
		if aim.y > -0.3:
			errs.append("flood %s does not aim down at its target" % s.name)
	if shadowed < 1 or shadowed > 4:
		errs.append("%d shadowed floods (want a few, 1..4)" % shadowed)
	var wet_kit = kit.get_surface_override_material(0)
	if not (wet_kit is ShaderMaterial) or wet_kit.get_shader_parameter("albedo_tex") != tex:
		errs.append("kit material not wetted onto kit_wet with its own albedo map")
	if kit.mesh.surface_get_material(0) != kit_src or kit_src.roughness != 1.0:
		errs.append("the kit's original material was changed")
	var wet_prim = prim.material_override
	if not (wet_prim is BaseMaterial3D) or wet_prim == prim_src or wet_prim.roughness >= prim_src.roughness \
			or wet_prim.albedo_color.v >= prim_src.albedo_color.v:
		errs.append("prims material not darkened and smoothed")
	# idempotent: applying again does not re-wet or duplicate floods
	look.apply()
	await tree.process_frame
	if kit.get_surface_override_material(0) != wet_kit or look.floods.size() != 5:
		errs.append("apply() is not idempotent")
	look.set_quality(0)
	await tree.process_frame
	var any_shadow := false
	for s in look.floods:
		any_shadow = any_shadow or s.shadow_enabled
	if any_shadow or look.environment.volumetric_fog_enabled or look.environment.ssr_enabled:
		errs.append("quality LOW still has flood shadows, volumetric fog or SSR")
	# the outline scan used by test_look_scene must catch an inverted hull (so its PASS means something)
	var hull := MeshInstance3D.new()
	hull.mesh = BoxMesh.new()
	var hm := StandardMaterial3D.new()
	hm.cull_mode = BaseMaterial3D.CULL_FRONT
	hm.grow = true
	hull.material_override = hm
	main.add_child(hull)
	if load("res://tests/test_look_scene.gd").outline_scan(main).is_empty():
		errs.append("outline_scan misses an inverted-hull material")
	main.queue_free()
	await tree.process_frame
	return errs

extends RefCounted
## G-LOOK (Wave 12), against a stand-in world (independent of the live Lot): the look waits for World.built, makes one
## floodlight per World.floodlights() entry with shadows on a few, wets `kit` / `prims` materials without replacing
## their maps or touching the originals, and the quality knob turns the costly features off.
## W13 (G-ATMOS): SSR and volumetric fog are requested only on Forward+ (Compatibility warns about them and ignores them);
## the night keys stay night (W17 G-SKY ruling: a lit overcast deck, not the W13 blue-black, so night_errs below holds
## a cold horizon, a night ceiling that rejects dusk, a zenith no brighter than the horizon, fog the horizon's colour);
## the ditch water gets the look's dark water.
const WORLD_SRC := """extends Node3D
signal built
var is_built := false
func floodlights() -> Array:
	return [{"pos": Vector3(0, 22, 0), "target": Vector3(20, 0, 0)}, {"pos": Vector3(40, 22, 0), "target": Vector3(20, 0, 5)},
		{"pos": Vector3(0, 22, 40), "target": Vector3(10, 0, 20)}, {"pos": Vector3(40, 22, 40), "target": Vector3(30, 0, 20)},
		{"pos": Vector3(-40, 22, 0), "target": Vector3(-20, 0, 0)}]
"""

## W17 G-SKY ruling: the night ceiling on the horizon's linear luminance (the SOURCE receipt's is 0.082, the hero
## reference's about 0.06-0.08; the W12 dusk horizon was 0.22).
const NIGHT_HORIZON_MAX := 0.10
## Skies night_errs must reject, linear RGB: [name, zenith, horizon, fog (null: the horizon), the failure it must report].
const RECEIPT_ZENITH := Color(0.044577, 0.063056, 0.087282)  # v1 receipt zenith, linear (the fog case)
const DUSK := [
	["a bright dusk horizon (linear 0.3)", Color(0.2, 0.22, 0.26), Color(0.29, 0.3, 0.33), null, "ceiling"],
	["a warm dusk horizon (r > b, under the ceiling)", Color(0.04, 0.05, 0.07), Color(0.09, 0.075, 0.06), null, "warm"],
	["a zenith brighter than the horizon", Color(0.08, 0.09, 0.1), Color(0.05, 0.06, 0.07), null, "zenith"],
	["fog the zenith's colour, not the horizon's", RECEIPT_ZENITH, Color(0.068, 0.085, 0.095), RECEIPT_ZENITH, "fog"],
]

## The night keys as the look holds them (sRGB Colors), checked in linear: the horizon is cold (r <= b; v2's warm
## lamp patches may warm parts of it, not its azimuth average) and under the night ceiling, the zenith is no brighter
## than the horizon, and the fog is the horizon's colour. Each failure starts with its kind: warm, ceiling, zenith, fog.
static func night_errs(zen: Color, hor: Color, fog: Color) -> Array:
	var out: Array = []
	var hl := hor.srgb_to_linear()
	var zl := zen.srgb_to_linear()
	if hl.r > hl.b:
		out.append("warm: the sky horizon %s is warm (r > b): it reads dusk, not night" % hl)
	if hl.get_luminance() > NIGHT_HORIZON_MAX:
		out.append("ceiling: the sky horizon's linear luminance %.3f is over the night ceiling %.2f (dusk)" \
				% [hl.get_luminance(), NIGHT_HORIZON_MAX])
	if zl.get_luminance() > hl.get_luminance():
		out.append("zenith: the sky zenith (linear luminance %.3f) is brighter than the horizon (%.3f)" \
				% [zl.get_luminance(), hl.get_luminance()])
	if fog != hor:
		out.append("fog: the fog colour %s is not the horizon colour %s" % [fog, hor])
	return out

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
	var water := MeshInstance3D.new()
	water.mesh = PlaneMesh.new()
	water.add_to_group("water")
	world.add_child(water)
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
	var wm = water.material_override
	if not (wm is BaseMaterial3D) or wm.resource_name != "look_water" or wm.albedo_color.v > 0.1 or wm.roughness > 0.1:
		errs.append("the ditch water did not get the look's dark still water")
	# the night keys (the SOURCE's receipt: its horizon is the mean of every column of the horizon rows, so the
	# azimuth average, which test_look_sky pins to the EXR) pass night_errs, and night_errs itself rejects dusk
	errs.append_array(night_errs(look.SKY_ZENITH, look.SKY_HORIZON, look.environment.fog_light_color))
	for d in DUSK:
		var dh: Color = d[2].linear_to_srgb()
		var df: Color = dh if d[3] == null else d[3].linear_to_srgb()
		var de: Array = night_errs(d[1].linear_to_srgb(), dh, df)
		if not de.any(func(m: String) -> bool: return m.begins_with(str(d[4]))):
			errs.append("night_errs passes %s (want a '%s' failure; got %s)" % [d[0], d[4], de])
	# Forward+ keeps its SSR and volumetric fog (the headless server reports the project's Forward+)
	if look.rendering_method == "forward_plus" and not (look.environment.ssr_enabled and look.environment.volumetric_fog_enabled):
		errs.append("Forward+ %s lost SSR or volumetric fog" % ["LOW", "MEDIUM", "HIGH"][look.quality])
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
	# SSR and volumetric fog exist only on Forward+: the feature table never asks for them elsewhere, and a look built
	# for Compatibility never turns them on at any quality (Q6: two engine warnings per launch)
	var LookScript: GDScript = load("res://look/look.gd")
	for method in ["gl_compatibility", "mobile"]:
		for q in 3:
			var f: Dictionary = LookScript.features(method, q)
			if f.ssr or f.volumetric_fog:
				errs.append("features(%s, %d) asks for SSR or volumetric fog" % [method, q])
	var ff: Dictionary = LookScript.features("forward_plus", 2)
	if not (ff.ssr and ff.volumetric_fog):
		errs.append("features(forward_plus, HIGH) lost SSR or volumetric fog")
	var host := Node3D.new()
	var compat: Node = LookScript.new()
	compat.rendering_method = "gl_compatibility"
	host.add_child(compat)
	tree.root.add_child(host)
	await tree.process_frame
	for q in [2, 1, 0, 2]:
		compat.set_quality(q)
		if compat.environment.ssr_enabled or compat.environment.volumetric_fog_enabled:
			errs.append("a Compatibility look at quality %d turned on SSR or volumetric fog" % q)
	host.queue_free()
	await tree.process_frame
	return errs

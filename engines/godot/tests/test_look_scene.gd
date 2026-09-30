extends RefCounted
## G-LOOK (Wave 12), on the real main scene: the look is the locked stylised-realistic one; no outline / inverted-hull
## material exists anywhere in the tree; the environment has fog and a filmic tonemapper (glow on emissives only);
## one sodium floodlight per World.floodlights() entry; the ground wears the wet shader; pet_material returns a
## material for every kind, species and team.
const GROUND_SHADER := "res://look/wet_ground.gdshader"

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var packed: PackedScene = load("res://main.tscn")
	var main := packed.instantiate()
	var look = main.get_node_or_null("Look")
	var world = main.get_node_or_null("World")
	if look == null or world == null:
		return ["main.tscn needs World and Look"]
	var applied := [false]
	look.applied.connect(func(): applied[0] = true)
	tree.root.add_child(main)
	for i in 900:
		if applied[0]:
			break
		await tree.process_frame
	await tree.process_frame
	if not applied[0]:
		errs.append("Look never applied its materials (World.built not seen)")
	if look.get("LOOK") != "stylised-realistic":
		errs.append("LOOK is %s, not stylised-realistic" % look.get("LOOK"))
	var env: Environment = look.environment
	if env == null:
		errs.append("Look has no Environment")
	else:
		if not env.fog_enabled:
			errs.append("fog is off")
		if not env.tonemap_mode in [Environment.TONE_MAPPER_AGX, Environment.TONE_MAPPER_ACES]:
			errs.append("tonemapper is %d, want AgX or ACES" % env.tonemap_mode)
		if env.glow_enabled and env.glow_hdr_threshold < 1.0:
			errs.append("glow threshold %.2f < 1: glow would bloom lit surfaces, not only emissives" % env.glow_hdr_threshold)
		if env.background_mode != Environment.BG_SKY or env.sky == null:
			errs.append("no night sky")
	var want: int = world.floodlights().size()
	if look.floods.size() != want:
		errs.append("%d floodlights for %d World.floodlights() entries" % [look.floods.size(), want])
	for s in look.floods:
		if not (s is SpotLight3D) or s.light_color.r < s.light_color.b * 2.0:
			errs.append("floodlight %s is not a sodium SpotLight3D" % s.name)
	for n in tree.get_nodes_in_group("ground"):
		var geo: Array = n.find_children("*", "GeometryInstance3D", true, false)
		if n is GeometryInstance3D:
			geo.append(n)
		for g in geo:
			var m = g.material_override
			if not (m is ShaderMaterial and m.shader != null and m.shader.resource_path == GROUND_SHADER):
				errs.append("ground %s does not wear the wet ground shader" % g.name)
	errs.append_array(outline_scan(tree.root))
	for kind in ["coat", "plate", "metal"]:
		for species in 2:
			for team in 2:
				if not (look.pet_material(kind, species, team) is Material):
					errs.append("pet_material(%s, %d, %d) is not a Material" % [kind, species, team])
	if look.pet_material("plate", 0, 0) == look.pet_material("plate", 0, 1):
		errs.append("both teams share one plate material: no team read")
	if look.pet_material("coat", 0, 0) != look.pet_material("coat", 0, 0):
		errs.append("pet_material is not cached (pets would not share materials)")
	main.queue_free()
	await tree.process_frame
	return errs


## Any ink-outline technique left over from the retired HARDENED look: an inverted hull (front-face culling with a
## grow / vertex push), an overlay or next_pass outline, or an outline-named material or node.
static func outline_scan(root: Node) -> Array:
	var errs: Array = []
	var geo := root.find_children("*", "GeometryInstance3D", true, false)
	for g in geo:
		if String(g.name).to_lower().contains("outline") or String(g.name).to_lower().contains("inkline"):
			errs.append("outline node %s" % g.get_path())
		var mats: Array = [g.material_override, g.material_overlay]
		var mesh: Mesh = null
		if g is MeshInstance3D:
			mesh = g.mesh
			for i in (mesh.get_surface_count() if mesh else 0):
				mats.append(g.get_surface_override_material(i))
		elif g is MultiMeshInstance3D and g.multimesh != null:
			mesh = g.multimesh.mesh
		for i in (mesh.get_surface_count() if mesh else 0):
			mats.append(mesh.surface_get_material(i))
		for m in mats:
			var depth := 0
			while m != null and depth < 8:
				var why := _outline_reason(m)
				if why != "":
					errs.append("%s on %s" % [why, g.get_path()])
				m = m.next_pass
				depth += 1
	return errs


static func _outline_reason(m: Material) -> String:
	var nm := m.resource_name.to_lower()
	if nm.contains("outline") or nm.contains("ink"):
		return "outline-named material '%s'" % m.resource_name
	if m is BaseMaterial3D and m.cull_mode == BaseMaterial3D.CULL_FRONT and m.grow:
		return "inverted-hull material (cull front + grow)"
	if m is ShaderMaterial and m.shader != null:
		var code: String = m.shader.code.replace(" ", "")
		if code.contains("cull_front") and (code.contains("NORMAL*") or code.contains("*NORMAL")):
			return "inverted-hull shader %s" % m.shader.resource_path
	return ""

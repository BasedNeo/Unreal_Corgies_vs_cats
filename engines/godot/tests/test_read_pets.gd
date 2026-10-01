extends RefCounted
## R-PETS (W13): the PLACEHOLDER pets read apart at range. A corgi and a cat differ in silhouette (body length to
## height, leg length, ear size, tail length and pose) and in coat (warm ochre vs cool grey, a white bib on the corgi);
## the two sides differ in the team band by hue, by luminance (the locked hues alone are ~1.07:1) and by pattern
## (one solid strap vs a split strap). Every pet emissive stays below the look's glow threshold. A pet is a handful of
## draws (one merged mesh, one surface per material), with no mouth or tongue and no ink outline.
const Model := preload("res://game/pet_model.gd")
const PetMaterials := preload("res://look/pet_materials.gd")
const T := preload("res://game/tuning.gd")
## The look's environment (look/look.gd _build_environment): glow starts at this HDR level, after this exposure.
const GLOW_THRESHOLD := 1.3
const EXPOSURE := 1.25
const MAX_DRAWS_PER_PET := 8  # model + rifle, one pass (W12 the whole play view was 257 draws)


func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var look: Node = load("res://look/look.gd").new()  # not in the tree: only its pet_material() is used
	var corgi: Dictionary = Model.layout(T.CORGI, 0)
	var cat: Dictionary = Model.layout(T.CAT, 1)
	errs.append_array(_silhouettes(corgi, cat))
	errs.append_array(_coats(look))
	errs.append_array(_bands(look))
	errs.append_array(_glow(look))
	# draws, no mouth or tongue, no outline, placeholder tag
	for species in 2:
		for team in 2:
			var root := Node3D.new()
			var m: Node3D = Model.build(species, team, look)
			root.add_child(m)
			m.add_child(Model.rifle(species, team, look))
			var draws := 0
			for g in root.find_children("*", "MeshInstance3D", true, false):
				draws += g.mesh.get_surface_count() if g.mesh != null else 0
				for i in (g.mesh.get_surface_count() if g.mesh != null else 0):
					if g.material_override == null and g.get_surface_override_material(i) == null \
							and g.mesh.surface_get_material(i) == null:
						errs.append("species %d team %d: surface %d of %s has no material" % [species, team, i, g.name])
			if draws > MAX_DRAWS_PER_PET:
				errs.append("species %d team %d costs %d draws per pass (want <= %d)" % [species, team, draws, MAX_DRAWS_PER_PET])
			if not m.get_meta("placeholder", false):
				errs.append("the pet model lost its placeholder tag")
			errs.append_array(load("res://tests/test_look_scene.gd").outline_scan(root))
			root.free()
		for part in Model.layout(species, 0).parts:
			if "mouth" in part or "tongue" in part:
				errs.append("species %d has a %s part (closed mouths only)" % [species, part])
	look.free()
	await tree.process_frame
	return errs


func _silhouettes(corgi: Dictionary, cat: Dictionary) -> Array:
	var e: Array = []
	var cp: Dictionary = corgi.parts
	var kp: Dictionary = cat.parts
	for need in ["body", "legs", "head", "ear_l", "ear_r", "tail", "band", "collar", "plate"]:
		if not cp.has(need) or not kp.has(need):
			return ["a pet layout lacks the part '%s'" % need]
	# body length to the height of the back: the corgi long and low, the cat about square
	var c_ratio: float = cp.body.size.z / cp.body.end.y
	var k_ratio: float = kp.body.size.z / kp.body.end.y
	if c_ratio < 1.7:
		e.append("corgi body length / back height %.2f (want >= 1.7: long and low)" % c_ratio)
	if k_ratio > 1.3:
		e.append("cat body length / back height %.2f (want <= 1.3)" % k_ratio)
	if kp.body.size.x > 0.75 * cp.body.size.x:
		e.append("cat body %.2f m wide vs corgi %.2f m: the cat should be slimmer" % [kp.body.size.x, cp.body.size.x])
	# legs: short on the corgi, long on the cat
	if cp.legs.size.y > 0.3:
		e.append("corgi legs %.2f m (want <= 0.30: short)" % cp.legs.size.y)
	if kp.legs.size.y < maxf(0.45, 1.8 * cp.legs.size.y):
		e.append("cat legs %.2f m vs corgi %.2f m (want >= 0.45 and >= 1.8x)" % [kp.legs.size.y, cp.legs.size.y])
	# ears: big upright on the corgi (taller than its head, tips well above it), small on the cat
	for ear in ["ear_l", "ear_r"]:
		var ce: AABB = cp[ear]
		var ke: AABB = kp[ear]
		if ce.size.y < 0.38 or ce.size.y < 1.1 * cp.head.size.y:
			e.append("corgi %s %.2f m tall, head %.2f m (want >= 0.38 and >= 1.1x the head)" % [ear, ce.size.y, cp.head.size.y])
		if ce.end.y < cp.head.end.y + 0.3:
			e.append("corgi %s tip only %.2f m above the head (want >= 0.30)" % [ear, ce.end.y - cp.head.end.y])
		if ke.size.y > 0.6 * ce.size.y:
			e.append("cat %s %.2f m vs corgi %.2f m (want <= 0.6x: small pointed ears)" % [ear, ke.size.y, ce.size.y])
		if ce.size.x * ce.size.y < 2.5 * ke.size.x * ke.size.y:
			e.append("corgi %s %.3f m2 vs cat %.3f m2 in side-on area (want >= 2.5x)" % [ear, ce.size.x * ce.size.y, ke.size.x * ke.size.y])
	# tails: a stub on the corgi; on the cat a long tail held up in an S, the tallest part of the silhouette
	if cp.tail.get_longest_axis_size() > 0.2:
		e.append("corgi tail %.2f m (want a stub, <= 0.20)" % cp.tail.get_longest_axis_size())
	var pts: PackedVector3Array = cat.tail
	var length := 0.0
	var turns := 0
	var prev := 0.0
	for i in range(1, pts.size()):
		length += pts[i].distance_to(pts[i - 1])
		var dz := pts[i].z - pts[i - 1].z
		if prev != 0.0 and signf(dz) != signf(prev):
			turns += 1
		prev = dz
	if length < 0.8:
		e.append("cat tail %.2f m long (want >= 0.80)" % length)
	if turns < 2:
		e.append("cat tail bends %d times (want an S: >= 2)" % turns)
	var top := 0.0
	for p in kp.values():
		top = maxf(top, p.end.y)
	if kp.tail.end.y < top - 0.001 or kp.tail.end.y < kp.ear_l.end.y + 0.15:
		e.append("cat tail top %.2f m is not the tallest part (ears %.2f, top %.2f)" % [kp.tail.end.y, kp.ear_l.end.y, top])
	return e


func _coats(look: Node) -> Array:
	var e: Array = []
	var c: Color = look.pet_material("coat", T.CORGI, 0).albedo_color
	var k: Color = look.pet_material("coat", T.CAT, 1).albedo_color
	if c.r - c.b < 0.3 or c.s < 0.45 or c.h > 0.14:
		e.append("corgi coat %s is not a warm ochre/tan" % c.to_html(false))
	if k.s > 0.15 or k.b < k.r:
		e.append("cat coat %s is not a cool grey" % k.to_html(false))
	if c.v < 0.5 or k.v < 0.5:
		e.append("a coat is too dark to read at night (corgi v %.2f, cat v %.2f)" % [c.v, k.v])
	var bib: Color = look.pet_material("accent", T.CORGI, 0).albedo_color
	if bib.v < 0.85 or bib.s > 0.15:
		e.append("corgi bib %s is not white" % bib.to_html(false))
	for sp in 2:
		var coat: BaseMaterial3D = look.pet_material("coat", sp, sp)
		if not coat.emission_enabled or coat.emission_energy_multiplier <= 0.0:
			e.append("species %d coat has no self-lit fill: a black silhouette away from the floods" % sp)
	return e


func _bands(look: Node) -> Array:
	var e: Array = []
	var lum := []
	for team in 2:
		var m: BaseMaterial3D = look.pet_material("band", team, team)
		var want: Color = T.TEAM_COLORS[team]
		if absf(m.albedo_color.h - want.h) > 0.01 or absf(m.emission.h - want.h) > 0.01:
			e.append("team %d band hue %.3f is not the locked team hue %.3f" % [team, m.albedo_color.h, want.h])
		var lin := m.emission.srgb_to_linear()
		lum.append((0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b) * m.emission_energy_multiplier)
		if look.pet_material("band", 0, team) != look.pet_material("band", 1, team):
			e.append("team %d: the two species do not share one band material" % team)
	if maxf(lum[0], lum[1]) < 2.0 * minf(lum[0], lum[1]):
		e.append("team bands differ only by hue: luminance %.3f vs %.3f (want >= 2:1)" % [lum[0], lum[1]])
	var solid: int = Model.layout(T.CORGI, 0).bands
	var split: int = Model.layout(T.CAT, 1).bands
	if solid == split or Model.layout(T.CAT, 0).bands != solid or Model.layout(T.CORGI, 1).bands != split:
		e.append("the team band pattern does not follow the team (Corgi Company %d straps, Cat Cadre %d)" % [solid, split])
	# the straps wrap the torso (seen from any side), not a patch on top
	for sp in 2:
		var p: Dictionary = Model.layout(sp, sp).parts
		var mid: float = p.body.get_center().y
		if p.band.size.x < 0.95 * p.body.size.x or p.band.position.y > mid - 0.1 or p.band.end.y < mid + 0.1:
			e.append("species %d: the band does not wrap the torso" % sp)
	return e


func _glow(look: Node) -> Array:
	var e: Array = []
	for kind in PetMaterials.KINDS:
		for sp in 2:
			for team in 2:
				var m = look.pet_material(kind, sp, team)
				if not (m is BaseMaterial3D) or not m.emission_enabled:
					continue
				var lin: Color = m.emission.srgb_to_linear()
				var peak: float = maxf(lin.r, maxf(lin.g, lin.b))
				# an emission texture (up to 1.0) multiplies the colour, or with the default ADD operator adds to it
				if m.emission_texture != null and m.emission_operator == BaseMaterial3D.EMISSION_OP_ADD:
					peak += 1.0
				peak *= m.emission_energy_multiplier * EXPOSURE
				if peak >= GLOW_THRESHOLD * 0.85:
					e.append("%s %d/%d emits %.2f: at or near the glow threshold %.2f" % [kind, sp, team, peak, GLOW_THRESHOLD])
	return e

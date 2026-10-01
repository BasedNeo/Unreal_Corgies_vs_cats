extends RefCounted
## R-PETS (W13): the PLACEHOLDER pets read apart at range. A corgi and a cat differ in silhouette (body length to
## height, leg length, ear size, tail length and pose) and in coat (warm ochre vs neutral grey, a white bib on the
## corgi); the two sides differ in the team band by hue, by luminance (the locked hues alone are ~1.07:1) and by pattern
## (one solid strap vs a split strap). Every pet emissive stays below the look's glow threshold. A pet is a handful of
## draws (one merged mesh, one surface per material), with no mouth or tongue and no ink outline.
## R-PETS2 (Q-READ): team must read at 30 m on its own and without hue: a team chest panel >= 0.3 m across seen
## head-on; pattern features >= 0.15 m; each team's band contrasts in lightness with its own coat (Corgi Company lighter
## than the tan corgi, Cat Cadre darker than the grey cat), so the two sides differ in greyscale too.
## W14 TEAM (Q-READ2: the near-white blue rendered white; a 5x4 px chest patch cannot carry the side at 30 m): the team
## paint covers most of the armour and a large share of each pet's visible area head-on and side on (measured here by
## rasterising the merged mesh orthographically); the Corgi blue is saturated and short of the tonemap shoulder; the
## chest shield is solid for Corgi Company and split for Cat Cadre.
const Model := preload("res://game/pet_model.gd")
const PetMaterials := preload("res://look/pet_materials.gd")
const T := preload("res://game/tuning.gd")
## The look's environment (look/look.gd _build_environment): glow starts at this HDR level, after this exposure.
const GLOW_THRESHOLD := 1.3
const EXPOSURE := 1.25
const MAX_DRAWS_PER_PET := 8  # model + rifle, one pass (W12 the whole play view was 257 draws)
## The least share of a pet's visible area in team paint, [side on, head-on], per species (corgi, cat). The cat's long
## legs, head and tail (its species cues, in coat) take more of its outline.
const MIN_TEAM_SHARE := [[0.4, 0.32], [0.3, 0.26]]


func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var look: Node = load("res://look/look.gd").new()  # not in the tree: only its pet_material() is used
	var corgi: Dictionary = Model.layout(T.CORGI, 0)
	var cat: Dictionary = Model.layout(T.CAT, 1)
	errs.append_array(_silhouettes(corgi, cat))
	errs.append_array(_coats(look))
	errs.append_array(_bands(look))
	errs.append_array(_team(look))
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
	for need in ["body", "legs", "head", "ear_l", "ear_r", "tail", "band", "collar", "trim", "panel", "bib"]:
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
	if k.s > 0.06 or k.b > k.r + 0.005:
		e.append("cat coat %s is not a neutral grey (no blue cast: Corgi Company's hue)" % k.to_html(false))
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
	if maxf(lum[0], lum[1]) < 3.0 * minf(lum[0], lum[1]):
		e.append("team bands differ only by hue: luminance %.3f vs %.3f (want >= 3:1)" % [lum[0], lum[1]])
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


## Team at 30 m without hue (R-PETS2). Each pet in its game pairing (species = team, match.gd).
func _team(look: Node) -> Array:
	var e: Array = []
	var band_l := []
	for sp in 2:
		var lay: Dictionary = Model.layout(sp, sp)
		var p: Dictionary = lay.parts
		var who: String = ["Corgi Company", "Cat Cadre"][sp]
		# a team part seen head-on, at least 0.3 m across, in front of the chest and below the head
		var pan: AABB = p.panel
		if pan.size.x < 0.3 or pan.size.y < 0.25:
			e.append("%s: chest panel %.2f x %.2f m (want >= 0.30 across, >= 0.25 tall)" % [who, pan.size.x, pan.size.y])
		if pan.position.z > p.bib.position.z or pan.position.z > p.body.position.z:
			e.append("%s: the chest panel is not in front of the chest (z %.2f)" % [who, pan.position.z])
		if pan.end.y > p.head.position.y + 0.03 or absf(pan.get_center().x) > 0.01:
			e.append("%s: the chest panel is not centred under the head" % who)
		if float(lay.band_feature) < 0.15:
			e.append("%s: team vest pattern feature %.2f m (want >= 0.15)" % [who, lay.band_feature])
		# the pattern follows the team on the chest too: Corgi Company one solid shield, Cat Cadre split in two
		if int(lay.chest) != sp + 1 or int(Model.layout(1 - sp, sp).chest) != sp + 1:
			e.append("%s: chest shield in %d pieces (want %d)" % [who, lay.chest, sp + 1])
		# the team paint covers most of the armour and a large share of the pet head-on and side on
		for view in [0, 2]:
			var cov := _coverage(lay.mesh, view)
			var vname: String = "side on" if view == 0 else "head-on"
			var share: float = cov.band / maxf(1.0, cov.total)
			var armour: float = cov.band / maxf(1.0, cov.band + cov.plate)
			if share < MIN_TEAM_SHARE[sp][view / 2]:
				e.append("%s %s: team paint is %.0f%% of the pet (want >= %.0f%%)" % [who, vname, share * 100.0,
					MIN_TEAM_SHARE[sp][view / 2] * 100.0])
			if armour < 0.6 or cov.plate == 0:
				e.append("%s %s: team paint is %.0f%% of the armour (want >= 60%%, with ochre trim)" % [who, vname, armour * 100.0])
		# lightness against its own coat, self-lit (what reads at night): the Corgi Company paint brighter than the corgi,
		# the Cat Cadre paint darker than the cat. (Measured through the look at 30 m: blue L* ~64 on a coat at L* 38;
		# crimson L* ~25 on a coat at L* 44-50.)
		var coat: BaseMaterial3D = look.pet_material("coat", sp, sp)
		var band: BaseMaterial3D = look.pet_material("band", sp, sp)
		var fur := _mean(coat.albedo_texture)
		var coat_glow := _y(coat.emission) * fur * coat.emission_energy_multiplier
		var band_glow := _y(band.emission) * band.emission_energy_multiplier
		band_l.append(band_glow)
		if sp == 0 and band_glow < 1.25 * coat_glow:
			e.append("%s paint glows %.3f vs its coat %.3f (want the paint >= 1.25x brighter)" % [who, band_glow, coat_glow])
		if sp == 1 and coat_glow < 3.0 * band_glow:
			e.append("%s paint glows %.3f vs its coat %.3f (want the coat >= 3x brighter)" % [who, band_glow, coat_glow])
	if band_l[0] < 3.0 * band_l[1]:
		e.append("team paint in greyscale: %.3f vs %.3f self-lit (want Corgi Company >= 3x Cat Cadre)" % [band_l[0], band_l[1]])
	# the Corgi blue stays a nameable blue on screen: saturated, and its self-lit peak short of the tonemap shoulder
	var blue: BaseMaterial3D = look.pet_material("band", 0, 0)
	var lab := _lab(blue.albedo_color)
	var c_star := Vector2(lab.y, lab.z).length()
	var hue := fposmod(rad_to_deg(atan2(lab.z, lab.y)), 360.0)
	if c_star < 45.0 or hue < 250.0 or hue > 310.0:
		e.append("Corgi Company paint is not a saturated blue: C* %.0f, hue %.0f (want C* >= 45, hue 250-310)" % [c_star, hue])
	var hdr := blue.emission.srgb_to_linear() * blue.emission_energy_multiplier * EXPOSURE
	var hi := maxf(hdr.r, maxf(hdr.g, hdr.b))
	var lo := minf(hdr.r, minf(hdr.g, hdr.b))
	if hi > 1.1 or 1.0 - lo / maxf(hi, 1e-6) < 0.7:
		e.append("Corgi Company paint emits %s after exposure: past the tonemap shoulder or too pale, it renders white" % str(hdr))
	return e


## Rasterises a merged pet mesh orthographically on a 2 cm grid with a depth test: view 0 side on (from +X), view 2
## head-on (from -Z, the way the pet faces). Returns the frontmost cells per surface: band (team paint), plate (ochre
## trim) and total.
static func _coverage(mesh: Mesh, view: int) -> Dictionary:
	const CELL := 0.02
	var u0 := -1.2
	var v0 := -0.1
	var w := 120
	var h := 90
	var depth := PackedFloat32Array()
	depth.resize(w * h)
	depth.fill(-INF)
	var owner := PackedInt32Array()
	owner.resize(w * h)
	owner.fill(-1)
	for s in mesh.get_surface_count():
		var a := mesh.surface_get_arrays(s)
		var vs: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
		var q := PackedVector3Array()
		q.resize(vs.size())
		for i in vs.size():  # (screen u, screen v, nearness)
			q[i] = Vector3(vs[i].z, vs[i].y, vs[i].x) if view == 0 else Vector3(vs[i].x, vs[i].y, -vs[i].z)
		for t in range(0, idx.size(), 3):
			var p0 := q[idx[t]]
			var p1 := q[idx[t + 1]]
			var p2 := q[idx[t + 2]]
			var area := (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
			if absf(area) < 1e-9:
				continue
			var i0 := maxi(0, int(floor((minf(p0.x, minf(p1.x, p2.x)) - u0) / CELL)))
			var i1 := mini(w - 1, int(floor((maxf(p0.x, maxf(p1.x, p2.x)) - u0) / CELL)))
			var j0 := maxi(0, int(floor((minf(p0.y, minf(p1.y, p2.y)) - v0) / CELL)))
			var j1 := mini(h - 1, int(floor((maxf(p0.y, maxf(p1.y, p2.y)) - v0) / CELL)))
			for j in range(j0, j1 + 1):
				var y := v0 + (j + 0.5) * CELL
				for i in range(i0, i1 + 1):
					var x := u0 + (i + 0.5) * CELL
					var b1 := ((x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (y - p0.y)) / area
					var b2 := ((p1.x - p0.x) * (y - p0.y) - (x - p0.x) * (p1.y - p0.y)) / area
					if b1 < 0.0 or b2 < 0.0 or b1 + b2 > 1.0:
						continue
					var d := p0.z + b1 * (p1.z - p0.z) + b2 * (p2.z - p0.z)
					var k := j * w + i
					if d > depth[k]:
						depth[k] = d
						owner[k] = s
	var out := {"band": 0, "plate": 0, "total": 0}
	var band_s := Model.SURFACES.find("band")
	var plate_s := Model.SURFACES.find("plate")
	for k in owner.size():
		if owner[k] < 0:
			continue
		out.total += 1
		if owner[k] == band_s:
			out.band += 1
		elif owner[k] == plate_s:
			out.plate += 1
	return out


static func _lab(c: Color) -> Vector3:
	var l := c.srgb_to_linear()
	var x := (0.4124 * l.r + 0.3576 * l.g + 0.1805 * l.b) / 0.95047
	var y := 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b
	var z := (0.0193 * l.r + 0.1192 * l.g + 0.9505 * l.b) / 1.08883
	var fx := pow(x, 1.0 / 3.0) if x > 0.008856 else 7.787 * x + 16.0 / 116.0
	var fy := pow(y, 1.0 / 3.0) if y > 0.008856 else 7.787 * y + 16.0 / 116.0
	var fz := pow(z, 1.0 / 3.0) if z > 0.008856 else 7.787 * z + 16.0 / 116.0
	return Vector3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


static func _y(c: Color) -> float:
	var l := c.srgb_to_linear()
	return 0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b


static func _lstar(y: float) -> float:
	return 116.0 * pow(y, 1.0 / 3.0) - 16.0 if y > 0.008856 else 903.3 * y


## Mean value (0..1) of a texture's image; 1.0 when there is none.
static func _mean(t: Texture2D) -> float:
	if t == null or t.get_image() == null:
		return 1.0
	var img := t.get_image()
	var sum := 0.0
	var n := 0
	for y in range(0, img.get_height(), 4):
		for x in range(0, img.get_width(), 4):
			sum += img.get_pixel(x, y).v
			n += 1
	return sum / maxf(1.0, n)

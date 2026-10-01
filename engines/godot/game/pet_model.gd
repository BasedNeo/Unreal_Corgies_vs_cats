extends RefCounted
## PLACEHOLDER pets, built in code from primitives (lane G-GAME) until the real character GLBs land.
## W13 (R-PETS): shaped to tell a corgi from a cat, and Corgi Company from Cat Cadre, at 30 m at night. The cues are
## the ones a placeholder can carry at range, exaggerated, not detail that vanishes:
## - Corgi: long, low barrel body (about 2:1 length to back height) on short legs; big upright ears (taller than the
##   head); a fox face (pointed white muzzle); a stub tail; warm ochre/tan coat with a white bib, muzzle and socks.
## - Cat: slim body (about 1:1) on long legs; small pointed ears; a long tail held up in an S, the tallest part of the
##   silhouette; cool grey tabby coat with a pale muzzle and chest.
## - Team (the side): the armour is painted in the team colour, self-lit below the glow threshold, with scuffed ochre
##   trim so it still reads as plate. W14 TEAM (Q-READ2: at 30 m a pet is about 7 x 20 px, so a chest patch cannot
##   carry the side): a barding vest over the back, flanks and chest front, a chest shield seen head-on, a collar.
##   It reads three ways: by hue (a saturated Corgi blue that stays blue through the tonemap; Cat crimson), by lightness
##   (the Corgi blue is lighter than the tan corgi, the dark crimson darker than the grey cat, so the sides also part in
##   greyscale and for red-green colour blindness), and by a coarse pattern (features of GAP = 0.15 m or more): Corgi
##   Company solid, Cat Cadre split by an ochre band, on the vest (side on) and on the chest (head-on).
## Closed mouth (no mouth or tongue geometry), no ink outline. Render only: the pet's collision is its capsule (pet.gd).
## Origin at the feet, facing -Z. Every part of a pet is merged into ONE mesh with one surface per material (coat,
## accent, dark, plate, band), built once per (species, team) and shared, so a pet costs 5 draws per pass (+2 rifle)
## instead of one per primitive. Materials come from `Look.pet_material(kind, species, team)` when the look provides it,
## otherwise from the fallback materials below.

const T := preload("res://game/tuning.gd")

## Mesh surfaces, in order; the model's MeshInstance3D has one material per surface.
const SURFACES := ["coat", "accent", "dark", "plate", "band"]
const RIFLE_SURFACES := ["metal", "band"]
const COAT := [Color("e38a3a"), Color("7d8591")]  # fallback: corgiOrange / catGrey (style-tokens.js)
const ACCENT := [Color("f6e7cf"), Color("d9dde3")]  # fallback: corgiCream / light grey muzzle and chest
const DARK := Color("1d1714")
## The Cat Cadre split (the ochre band across the vest and down the chest): at 30 m and ~15 px/m it is 2-3 px.
const GAP := 0.15
## The ochre rims at the ends of the vest.
const TRIM := 0.04

static var _layouts := {}  # "species_team" -> layout (see layout())
static var _rifle_mesh: ArrayMesh
static var _fallback := {}


static func build(species: int, team: int, look: Node) -> Node3D:
	var root := Node3D.new()
	root.name = "Model"
	root.set_meta("placeholder", true)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = layout(species, team).mesh
	for i in SURFACES.size():
		mi.set_surface_override_material(i, _mat(look, SURFACES[i], species, team))
	root.add_child(mi)
	return root


## The rifle body (metal, a team band strip on top) with its muzzle marker at the barrel tip, -Z forward.
static func rifle(species: int, team: int, look: Node) -> Node3D:
	var root := Node3D.new()
	root.name = "RifleModel"
	if _rifle_mesh == null:
		var k := Kit.new()
		k.box("metal", Vector3(0.07, 0.1, 0.34), Vector3(0, 0, 0.02))
		k.cyl("metal", 0.022, 0.022, 0.32, Vector3(0, 0.015, -0.3), Vector3(90, 0, 0))
		k.box("metal", Vector3(0.05, 0.12, 0.06), Vector3(0, -0.09, 0.06))
		k.box("band", Vector3(0.075, 0.03, 0.14), Vector3(0, 0.065, 0.0))
		_rifle_mesh = k.mesh(RIFLE_SURFACES)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = _rifle_mesh
	for i in RIFLE_SURFACES.size():
		mi.set_surface_override_material(i, _mat(look, RIFLE_SURFACES[i], species, team))
	root.add_child(mi)
	var muzzle := Marker3D.new()
	muzzle.name = "Muzzle"
	muzzle.position = Vector3(0, 0.015, -0.47)
	root.add_child(muzzle)
	return root


## The shared geometry of one (species, team): {mesh: ArrayMesh (SURFACES order), parts: {name: AABB in model space},
## tail: PackedVector3Array (the tail's centre line), bands: int (torso straps: 1 solid or 2 split), band_feature: float
## (the smallest team block or gap, metres), chest: int (team pieces on the chest shield: 1 solid or 2 split)}. Cached.
static func layout(species: int, team: int) -> Dictionary:
	species = clampi(species, 0, 1)
	team = clampi(team, 0, 1)
	var key := "%d_%d" % [species, team]
	if not _layouts.has(key):
		var k := Kit.new()
		if species == T.CORGI:
			_corgi(k, team)
		else:
			_cat(k, team)
		_layouts[key] = {"mesh": k.mesh(SURFACES), "parts": k.parts, "tail": k.tail, "bands": k.bands,
			"band_feature": k.band_feature, "chest": k.chest}
	return _layouts[key]


static func _corgi(k: Kit, team: int) -> void:
	# long, low barrel body lying along Z: 1.26 m long, back at 0.66 m
	k.capsule("coat", 0.24, 1.26, Vector3(0, 0.42, 0.05), Vector3(90, 0, 0), "body")
	k.ellipsoid("accent", Vector3(0.19, 0.21, 0.17), Vector3(0, 0.4, -0.5), "bib")  # white chest
	# short legs with white socks
	for p in [Vector3(-0.14, 0, -0.36), Vector3(0.14, 0, -0.36), Vector3(-0.14, 0, 0.44), Vector3(0.14, 0, 0.44)]:
		k.cyl("coat", 0.075, 0.065, 0.24, p + Vector3(0, 0.13, 0), Vector3.ZERO, "legs")
		k.ellipsoid("accent", Vector3(0.08, 0.045, 0.1), p + Vector3(0, 0.04, -0.02), "socks")
	# neck, head, fox face: a pointed white muzzle (closed: no mouth), nose, eyes
	k.segment("coat", Vector3(0, 0.5, -0.45), Vector3(0, 0.72, -0.6), 0.15, "neck")
	k.ellipsoid("coat", Vector3(0.21, 0.18, 0.2), Vector3(0, 0.78, -0.64), "head")
	k.ellipsoid("accent", Vector3(0.15, 0.09, 0.12), Vector3(0, 0.69, -0.72), "muzzle")
	k.cyl("accent", 0.03, 0.085, 0.26, Vector3(0, 0.72, -0.86), Vector3(-90, 0, 0), "muzzle")
	k.ellipsoid("dark", Vector3(0.04, 0.035, 0.035), Vector3(0, 0.73, -0.99), "nose")
	for s in [-1.0, 1.0]:
		k.ellipsoid("dark", Vector3(0.03, 0.032, 0.022), Vector3(0.085 * s, 0.84, -0.79), "eyes")
		# big upright ears, taller than the head: the corgi's signature at range (cream inside, seen from the front)
		var ear := Kit.pivot(Vector3(0.08 * s, 0.84, -0.6), Vector3(0, 0, -13.0 * s))
		k.prism("coat", Vector3(0.25, 0.5, 0.07), ear * Kit.at(Vector3(0, 0.25, 0)), "ear_l" if s < 0 else "ear_r")
		k.prism("accent", Vector3(0.15, 0.3, 0.02), ear * Kit.at(Vector3(0, 0.2, -0.04)))
	k.ellipsoid("coat", Vector3(0.08, 0.07, 0.08), Vector3(0, 0.56, 0.7), "tail")  # stub tail
	# team armour: a barding vest over the front two thirds of the torso (0.80 m), a chest shield 0.50 m across, a collar
	_vest(k, team, Vector3(0, 0.42, -0.05), 0.258, 0.8)
	_collar(k, Vector3(0, 0.5, -0.45), Vector3(0, 0.72, -0.6), 0.35, 0.165)
	_chest(k, team, Vector3(0, 0.38, -0.7), 0.5, 0.24, 0.16)


static func _cat(k: Kit, team: int) -> void:
	# slim body on long legs: 0.84 m long, back at 0.77 m
	k.capsule("coat", 0.15, 0.84, Vector3(0, 0.62, 0.0), Vector3(90, 0, 0), "body")
	k.ellipsoid("coat", Vector3(0.14, 0.17, 0.17), Vector3(0, 0.6, 0.27), "body")  # haunches
	k.ellipsoid("accent", Vector3(0.11, 0.13, 0.12), Vector3(0, 0.58, -0.34), "bib")
	for p in [Vector3(-0.085, 0, -0.27), Vector3(0.085, 0, -0.27), Vector3(-0.085, 0, 0.27), Vector3(0.085, 0, 0.27)]:
		k.cyl("coat", 0.045, 0.037, 0.52, p + Vector3(0, 0.27, 0), Vector3.ZERO, "legs")
		k.ellipsoid("coat", Vector3(0.05, 0.03, 0.065), p + Vector3(0, 0.03, -0.015), "legs")
	# neck, round head, small flat muzzle (closed: no mouth), nose, eyes
	k.segment("coat", Vector3(0, 0.7, -0.32), Vector3(0, 0.88, -0.42), 0.085, "neck")
	k.ellipsoid("coat", Vector3(0.15, 0.135, 0.14), Vector3(0, 0.93, -0.46), "head")
	k.ellipsoid("accent", Vector3(0.075, 0.055, 0.06), Vector3(0, 0.88, -0.58), "muzzle")
	k.ellipsoid("dark", Vector3(0.022, 0.018, 0.018), Vector3(0, 0.9, -0.64), "nose")
	for s in [-1.0, 1.0]:
		k.ellipsoid("dark", Vector3(0.026, 0.03, 0.02), Vector3(0.06 * s, 0.96, -0.575), "eyes")
		# small pointed ears
		var ear := Kit.pivot(Vector3(0.075 * s, 1.0, -0.45), Vector3(0, 0, -12.0 * s))
		k.cyl_at("coat", 0.0, 0.07, 0.2, ear * Kit.at(Vector3(0, 0.1, 0)), "ear_l" if s < 0 else "ear_r")
	# a long tail held up in an S, above the head: the cat's signature at range
	var pts := PackedVector3Array()
	for i in 7:
		var t := i / 6.0
		pts.append(Vector3(0, 0.68 + 0.78 * t, 0.42 + 0.2 * t + 0.12 * sin(TAU * t)))
	for i in pts.size() - 1:
		k.segment("coat", pts[i], pts[i + 1], lerpf(0.065, 0.045, i / 5.0), "tail")
	k.tail = pts
	# team armour: a barding vest over the whole torso (0.72 m), a chest shield 0.50 m across (wider than the cat), a collar
	_vest(k, team, Vector3(0, 0.62, -0.01), 0.18, 0.72)
	_collar(k, Vector3(0, 0.7, -0.32), Vector3(0, 0.88, -0.42), 0.3, 0.1)
	_chest(k, team, Vector3(0, 0.61, -0.48), 0.5, 0.18, 0.14)


## The barding vest around the torso (axis Z), centred at `c`, `length` long, in the team colour with open ochre rims
## (TRIM) at both ends. Its closed front end is a team-coloured disc around the chest, seen head-on. Corgi Company: one
## solid block. Cat Cadre: two blocks split by a GAP-wide ochre band (a pattern that resolves side on at 30 m).
static func _vest(k: Kit, team: int, c: Vector3, radius: float, length: float) -> void:
	var inner := length - 2.0 * TRIM
	if team == 0:
		k.cyl("band", radius, radius, inner, c, Vector3(90, 0, 0), "band")
		k.bands = 1
		k.band_feature = inner
	else:
		var block := (inner - GAP) * 0.5
		for s in [-1.0, 1.0]:
			k.cyl("band", radius, radius, block, c + Vector3(0, 0, s * (GAP + block) * 0.5), Vector3(90, 0, 0), "band")
		k.tube("plate", radius + 0.004, GAP, Kit.at(c, Vector3(90, 0, 0)), "trim")
		k.bands = 2
		k.band_feature = minf(block, GAP)
	for s in [-1.0, 1.0]:
		k.tube("plate", radius + 0.012, TRIM, Kit.at(c + Vector3(0, 0, s * (inner + TRIM) * 0.5), Vector3(90, 0, 0)), "trim")


## The team chest shield, `width` across, `top` m above `seam` and `point` m below it, its lower edge tucked back 8
## degrees to follow the chest; it faces -Z, so a pet coming at you shows it. Corgi Company: a solid shield (a pointed
## bottom) on an ochre backing that shows as a rim. Cat Cadre: a square plate split down the middle by a GAP-wide ochre
## strip.
static func _chest(k: Kit, team: int, seam: Vector3, width: float, top: float, point: float) -> void:
	var f := Kit.at(seam, Vector3(-8, 0, 0))
	if team == 0:
		k.box_at("band", Vector3(width, top, 0.04), f * Kit.at(Vector3(0, top * 0.5, 0)), "panel")
		k.prism("band", Vector3(width, point, 0.04), f * Kit.at(Vector3(0, -point * 0.5, 0), Vector3(0, 0, 180)), "panel")
		var b := Kit.at(Vector3(0, 0, 0.02))  # the ochre backing, 0.025 m proud all round
		k.box_at("plate", Vector3(width + 0.05, top + 0.025, 0.03), f * b * Kit.at(Vector3(0, top * 0.5, 0)), "trim")
		k.prism("plate", Vector3(width + 0.05, point + 0.04, 0.03), f * b * Kit.at(Vector3(0, -(point + 0.04) * 0.5, 0),
			Vector3(0, 0, 180)), "trim")
		k.chest = 1
	else:
		var h := top + point
		var strip := maxf(GAP, (width - GAP) * 0.5)
		for s in [-1.0, 1.0]:
			k.box_at("band", Vector3(strip, h, 0.04), f * Kit.at(Vector3(s * (GAP + strip) * 0.5, top - h * 0.5, 0)), "panel")
		k.box_at("plate", Vector3(GAP, h, 0.035), f * Kit.at(Vector3(0, top - h * 0.5, 0.003)), "trim")
		k.chest = 2


## A collar ring around the neck from a to b, `along` of the way up.
static func _collar(k: Kit, a: Vector3, b: Vector3, along: float, radius: float) -> void:
	k.cyl_at("band", radius, radius, 0.06, Kit.along(a.lerp(b, along), b - a), "collar")

# --- materials ---------------------------------------------------------------------------------------------------

static func _mat(look: Node, kind: String, species: int, team: int) -> Material:
	if look != null and look.has_method("pet_material"):
		var got = look.pet_material(kind, species, team)
		if got is Material:
			return got
	var key := "%s_%d_%d" % [kind, species, team]
	if not _fallback.has(key):
		_fallback[key] = _fallback_mat(kind, species, team)
	return _fallback[key]


static func _fallback_mat(kind: String, species: int, team: int) -> StandardMaterial3D:
	match kind:
		"coat":
			var c := _plain(COAT[species], 0.8, 0.0)
			c.rim_enabled = true  # soft fur sheen, not a clay look
			c.rim = 0.35
			c.rim_tint = 0.6
			return c
		"accent":
			return _plain(ACCENT[species], 0.75, 0.0)
		"dark":
			return _plain(DARK, 0.35, 0.0)
		"band":
			# the team colour, light for Corgi Company and dark for Cat Cadre; self-lit, below the glow threshold
			var c: Color = T.TEAM_COLORS[team].lightened(0.6) if team == 0 else T.TEAM_COLORS[team].darkened(0.45)
			var b := _plain(c, 0.4, 0.0)
			b.emission_enabled = true
			b.emission = c
			b.emission_energy_multiplier = 0.6
			return b
		"plate":
			return _plain(Color(0.74, 0.53, 0.16), 0.42, 0.15)
		_:
			return _plain(Color("3a3f46"), 0.38, 0.8)


static func _plain(c: Color, rough: float, metal: float) -> StandardMaterial3D:
	var s := StandardMaterial3D.new()
	s.albedo_color = c
	s.roughness = rough
	s.metallic = metal
	return s

# --- the merged-mesh kit -----------------------------------------------------------------------------------------

## Collects primitives per material surface, transformed into model space (normals by the inverse transpose, so the
## scaled spheres shade right), and records each named part's model-space AABB for the read tests.
class Kit:
	var surfs := {}  # kind -> Surf
	var parts := {}  # part name -> AABB
	var tail := PackedVector3Array()
	var bands := 0
	var band_feature := 0.0
	var chest := 0

	static func at(pos: Vector3, rot_deg := Vector3.ZERO, scale := Vector3.ONE) -> Transform3D:
		var r := Basis.from_euler(Vector3(deg_to_rad(rot_deg.x), deg_to_rad(rot_deg.y), deg_to_rad(rot_deg.z)))
		return Transform3D(r * Basis.from_scale(scale), pos)

	## A frame at `base` turned by `rot_deg`: children placed in it rotate about the base (ears hinge at the skull).
	static func pivot(base: Vector3, rot_deg: Vector3) -> Transform3D:
		return at(base, rot_deg)

	## A frame at `c` whose +Y runs along `dir` (for capsules and rings between two points).
	static func along(c: Vector3, dir: Vector3) -> Transform3D:
		var up := dir.normalized()
		var ref := Vector3.RIGHT if absf(up.x) < 0.9 else Vector3.FORWARD
		var z := ref.cross(up).normalized()
		return Transform3D(Basis(up.cross(z), up, z), c)

	func put(kind: String, prim: PrimitiveMesh, xf: Transform3D, part := "") -> void:
		if not surfs.has(kind):
			surfs[kind] = Surf.new()
		var box: AABB = surfs[kind].add(prim.get_mesh_arrays(), xf)
		if part != "":
			parts[part] = parts[part].merge(box) if parts.has(part) else box

	func ellipsoid(kind: String, radii: Vector3, pos: Vector3, part := "") -> void:
		var s := SphereMesh.new()
		s.radius = 1.0
		s.height = 2.0
		s.radial_segments = 12
		s.rings = 6
		put(kind, s, at(pos, Vector3.ZERO, radii), part)

	func capsule(kind: String, radius: float, height: float, pos: Vector3, rot: Vector3, part := "") -> void:
		var c := CapsuleMesh.new()
		c.radius = radius
		c.height = height
		c.radial_segments = 16
		c.rings = 6
		put(kind, c, at(pos, rot), part)

	func cyl(kind: String, top: float, bottom: float, height: float, pos: Vector3, rot := Vector3.ZERO, part := "") -> void:
		cyl_at(kind, top, bottom, height, at(pos, rot), part)

	func cyl_at(kind: String, top: float, bottom: float, height: float, xf: Transform3D, part := "") -> void:
		var c := CylinderMesh.new()
		c.top_radius = top
		c.bottom_radius = bottom
		c.height = height
		c.radial_segments = 12
		c.rings = 1
		put(kind, c, xf, part)

	## An open ring (no caps): a rim around something, seen from outside.
	func tube(kind: String, radius: float, height: float, xf: Transform3D, part := "") -> void:
		var c := CylinderMesh.new()
		c.top_radius = radius
		c.bottom_radius = radius
		c.height = height
		c.radial_segments = 12
		c.rings = 1
		c.cap_top = false
		c.cap_bottom = false
		put(kind, c, xf, part)

	func box(kind: String, size: Vector3, pos: Vector3, part := "") -> void:
		box_at(kind, size, at(pos), part)

	func box_at(kind: String, size: Vector3, xf: Transform3D, part := "") -> void:
		var b := BoxMesh.new()
		b.size = size
		put(kind, b, xf, part)

	func prism(kind: String, size: Vector3, xf: Transform3D, part := "") -> void:
		var p := PrismMesh.new()
		p.size = size
		put(kind, p, xf, part)

	## A capsule from a to b (the radius caps reach just past both ends, so a chain of segments has no gaps).
	func segment(kind: String, a: Vector3, b: Vector3, radius: float, part := "") -> void:
		var c := CapsuleMesh.new()
		c.radius = radius
		c.height = a.distance_to(b) + radius * 2.0
		c.radial_segments = 10
		c.rings = 2
		put(kind, c, along((a + b) * 0.5, b - a), part)

	func mesh(order: Array) -> ArrayMesh:
		var m := ArrayMesh.new()
		for kind in order:
			var s: Surf = surfs[kind]
			var arr := []
			arr.resize(Mesh.ARRAY_MAX)
			arr[Mesh.ARRAY_VERTEX] = s.v
			arr[Mesh.ARRAY_NORMAL] = s.n
			arr[Mesh.ARRAY_INDEX] = s.idx
			m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		return m


class Surf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var idx := PackedInt32Array()

	func add(arrays: Array, xf: Transform3D) -> AABB:
		var base := v.size()
		var sv: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var sn: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var nb := xf.basis.inverse().transposed()
		var box := AABB(xf * sv[0], Vector3.ZERO)
		for i in sv.size():
			var p: Vector3 = xf * sv[i]
			v.append(p)
			n.append((nb * sn[i]).normalized())
			box = box.expand(p)
		for i in arrays[Mesh.ARRAY_INDEX]:
			idx.append(base + i)
		return box

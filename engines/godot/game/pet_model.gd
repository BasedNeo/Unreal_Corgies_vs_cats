extends RefCounted
## PLACEHOLDER pets, built in code from primitives (lane G-GAME) until the real character GLBs land.
## Silhouettes are made to read at 30 m: the Corgi is long and low with big upright ears; the Cat is slimmer, on
## longer legs, with small pointed ears and a tall curled tail. Colour-coded by team with a vest plate and trim.
## Team-coloured glowing trim sits on each species' signature (corgi ears and back line, cat tail) so the silhouette
## still reads on the wet night. Closed mouth (no mouth or tongue geometry). Render only: the pet's collision is its capsule (pet.gd).
## Origin at the feet, facing -Z. Materials come from `Look.pet_material(kind, species, team)` when G-LOOK provides
## it (kinds: coat / plate / metal), otherwise from the fallback materials below.

const T := preload("res://game/tuning.gd")

const COAT := [Color("e38a3a"), Color("7d8591")]  # corgiOrange / catGrey (style-tokens.js)
const ACCENT := [Color("f6e7cf"), Color("d9dde3")]  # corgiCream / light grey muzzle and chest
const DARK := Color("1d1714")

static func build(species: int, team: int, look: Node) -> Node3D:
	var root := Node3D.new()
	root.name = "Model"
	var mats := {
		"coat": _mat(look, "coat", species, team),
		"plate": _mat(look, "plate", species, team),
		"trim": _trim(team),
		"accent": _plain(ACCENT[species], 0.75, 0.0),
		"dark": _plain(DARK, 0.35, 0.0),
	}
	if species == T.CORGI:
		_corgi(root, mats)
	else:
		_cat(root, mats)
	return root

## The rifle body (metal) with its muzzle marker at the barrel tip, -Z forward.
static func rifle(species: int, team: int, look: Node) -> Node3D:
	var root := Node3D.new()
	root.name = "RifleModel"
	var metal := _mat(look, "metal", species, team)
	_box(root, Vector3(0.07, 0.1, 0.34), Vector3(0, 0, 0.02), metal)
	_cyl(root, 0.022, 0.022, 0.32, Vector3(0, 0.015, -0.3), Vector3(90, 0, 0), metal)
	_box(root, Vector3(0.05, 0.12, 0.06), Vector3(0, -0.09, 0.06), metal)
	_box(root, Vector3(0.075, 0.03, 0.14), Vector3(0, 0.065, 0.0), _trim(team))
	var muzzle := Marker3D.new()
	muzzle.name = "Muzzle"
	muzzle.position = Vector3(0, 0.015, -0.47)
	root.add_child(muzzle)
	return root

static func _corgi(r: Node3D, m: Dictionary) -> void:
	# long, low barrel body lying along Z
	_capsule(r, 0.25, 1.02, Vector3(0, 0.44, 0.02), Vector3(90, 0, 0), m.coat)
	_sphere(r, Vector3(0.21, 0.19, 0.3), Vector3(0, 0.36, -0.28), m.accent)  # cream chest
	# short legs
	for p in [Vector3(-0.14, 0, -0.3), Vector3(0.14, 0, -0.3), Vector3(-0.14, 0, 0.3), Vector3(0.14, 0, 0.3)]:
		_cyl(r, 0.07, 0.06, 0.28, p + Vector3(0, 0.14, 0), Vector3.ZERO, m.coat)
		_sphere(r, Vector3(0.075, 0.04, 0.09), p + Vector3(0, 0.03, -0.02), m.accent)
	# head, muzzle (closed), nose, eyes
	_sphere(r, Vector3(0.2, 0.19, 0.2), Vector3(0, 0.72, -0.52), m.coat)
	_sphere(r, Vector3(0.11, 0.09, 0.15), Vector3(0, 0.66, -0.68), m.accent)
	_sphere(r, Vector3(0.04, 0.035, 0.035), Vector3(0, 0.7, -0.82), m.dark)
	for s in [-1.0, 1.0]:
		_sphere(r, Vector3(0.028, 0.03, 0.02), Vector3(0.08 * s, 0.78, -0.69), m.dark)
		# big upright ears: the corgi's signature at range
		var ear := _prism(r, Vector3(0.2, 0.32, 0.06), Vector3(0.12 * s, 1.02, -0.47), Vector3(0, 0, -14.0 * s), m.coat)
		_prism(ear, Vector3(0.12, 0.2, 0.02), Vector3(0, -0.03, -0.035), Vector3.ZERO, m.trim)
	_sphere(r, Vector3(0.08, 0.07, 0.08), Vector3(0, 0.5, 0.56), m.coat)  # stub tail
	# team vest plate + trim stripe
	_box(r, Vector3(0.56, 0.2, 0.5), Vector3(0, 0.62, -0.02), m.plate)
	# a long glowing back stripe: at range the corgi reads as one long low line under two big ears
	_box(r, Vector3(0.09, 0.05, 0.98), Vector3(0, 0.735, 0.02), m.trim)

static func _cat(r: Node3D, m: Dictionary) -> void:
	# slim body on longer legs
	_capsule(r, 0.16, 0.78, Vector3(0, 0.55, 0.0), Vector3(90, 0, 0), m.coat)
	_sphere(r, Vector3(0.12, 0.14, 0.18), Vector3(0, 0.5, -0.2), m.accent)
	for p in [Vector3(-0.09, 0, -0.24), Vector3(0.09, 0, -0.24), Vector3(-0.09, 0, 0.24), Vector3(0.09, 0, 0.24)]:
		_cyl(r, 0.045, 0.04, 0.46, p + Vector3(0, 0.23, 0), Vector3.ZERO, m.coat)
	# head: rounder, smaller muzzle, closed mouth
	_sphere(r, Vector3(0.155, 0.14, 0.15), Vector3(0, 0.84, -0.42), m.coat)
	_sphere(r, Vector3(0.07, 0.05, 0.07), Vector3(0, 0.8, -0.54), m.accent)
	_sphere(r, Vector3(0.025, 0.02, 0.02), Vector3(0, 0.83, -0.6), m.dark)
	for s in [-1.0, 1.0]:
		_sphere(r, Vector3(0.026, 0.03, 0.02), Vector3(0.06 * s, 0.88, -0.55), m.dark)
		# small pointed ears
		_cyl(r, 0.0, 0.055, 0.13, Vector3(0.085 * s, 0.99, -0.42), Vector3(0, 0, -12.0 * s), m.coat)
	# tall curled tail: the cat's signature at range
	var pts := [Vector3(0, 0.6, 0.36), Vector3(0, 0.74, 0.5), Vector3(0, 0.94, 0.56), Vector3(0, 1.12, 0.52),
		Vector3(0, 1.24, 0.42)]
	for i in pts.size() - 1:  # the upper tail glows in the team trim: at range the cat reads as a tall curl
		_segment(r, pts[i], pts[i + 1], 0.045 - 0.006 * i, m.coat if i < 2 else m.trim)
	# team vest plate + trim stripe
	_box(r, Vector3(0.38, 0.17, 0.44), Vector3(0, 0.7, -0.02), m.plate)
	_box(r, Vector3(0.4, 0.045, 0.07), Vector3(0, 0.74, -0.16), m.trim)
	_box(r, Vector3(0.4, 0.045, 0.07), Vector3(0, 0.74, 0.12), m.trim)

# --- materials ---------------------------------------------------------------------------------------------------

static func _mat(look: Node, kind: String, species: int, team: int) -> Material:
	if look != null and look.has_method("pet_material"):
		var got = look.pet_material(kind, species, team)
		if got is Material:
			return got
	match kind:
		"coat":
			var c := _plain(COAT[species], 0.8, 0.0)
			c.rim_enabled = true  # soft fur sheen, not a clay look
			c.rim = 0.35
			c.rim_tint = 0.6
			return c
		"plate":
			var p := _plain(T.TEAM_COLORS[team], 0.42, 0.15)
			p.emission_enabled = true  # team colour still reads on a dark night
			p.emission = T.TEAM_COLORS[team]
			p.emission_energy_multiplier = 0.35
			return p
		_:
			return _plain(Color("3a3f46"), 0.38, 0.8)

static func _trim(team: int) -> StandardMaterial3D:
	var t := _plain(T.TEAM_COLORS[team].lightened(0.35), 0.3, 0.0)
	t.emission_enabled = true
	t.emission = T.TEAM_COLORS[team].lightened(0.25)
	t.emission_energy_multiplier = 1.6
	return t

static func _plain(c: Color, rough: float, metal: float) -> StandardMaterial3D:
	var s := StandardMaterial3D.new()
	s.albedo_color = c
	s.roughness = rough
	s.metallic = metal
	return s

# --- primitives ----------------------------------------------------------------------------------------------------

static func _add(parent: Node3D, mesh: Mesh, pos: Vector3, rot_deg: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation_degrees = rot_deg
	mi.material_override = mat
	parent.add_child(mi)
	return mi

static func _sphere(p: Node3D, radii: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var s := SphereMesh.new()
	s.radius = 1.0
	s.height = 2.0
	s.radial_segments = 16
	s.rings = 8
	var mi := _add(p, s, pos, Vector3.ZERO, mat)
	mi.scale = radii
	return mi

static func _capsule(p: Node3D, radius: float, height: float, pos: Vector3, rot: Vector3, mat: Material) -> MeshInstance3D:
	var c := CapsuleMesh.new()
	c.radius = radius
	c.height = height
	c.radial_segments = 16
	c.rings = 6
	return _add(p, c, pos, rot, mat)

static func _cyl(p: Node3D, top: float, bottom: float, height: float, pos: Vector3, rot: Vector3, mat: Material) -> MeshInstance3D:
	var c := CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = height
	c.radial_segments = 10
	c.rings = 1
	return _add(p, c, pos, rot, mat)

static func _box(p: Node3D, size: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var b := BoxMesh.new()
	b.size = size
	return _add(p, b, pos, Vector3.ZERO, mat)

static func _prism(p: Node3D, size: Vector3, pos: Vector3, rot: Vector3, mat: Material) -> MeshInstance3D:
	var pr := PrismMesh.new()
	pr.size = size
	return _add(p, pr, pos, rot, mat)

static func _segment(p: Node3D, a: Vector3, b: Vector3, radius: float, mat: Material) -> void:
	var c := CapsuleMesh.new()
	c.radius = radius
	c.height = a.distance_to(b) + radius * 2.0
	c.radial_segments = 8
	c.rings = 2
	var mi := MeshInstance3D.new()
	mi.mesh = c
	mi.material_override = mat
	p.add_child(mi)
	var up := (b - a).normalized()
	var side := Vector3.RIGHT.cross(up).normalized()
	mi.transform = Transform3D(Basis(Vector3.RIGHT, up, side).orthonormalized(), (a + b) * 0.5)

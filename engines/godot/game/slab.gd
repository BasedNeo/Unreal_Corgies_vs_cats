extends Node3D
## The control slab's rules and state read-out (lane G-GAME). The slab itself (its concrete, its place) is the world's:
## `World.slab() -> {center, size}`. This node answers who is on it and shows the state with a glowing frame and a
## light: dim white = neutral, team colour = held, flashing amber = contested.

const T := preload("res://game/tuning.gd")
const NEUTRAL := Color(0.8, 0.82, 0.86)
const CONTESTED := Color(1.0, 0.62, 0.12)

var center := Vector3.ZERO
var size := Vector2(8, 8)
var _mat: StandardMaterial3D
var _fill: StandardMaterial3D
var _light: OmniLight3D
var _visual: Node3D
var _probes := 30
var _t := 0.0

func setup(c: Vector3, s: Vector2) -> void:
	center = c
	size = s
	name = "SlabState"
	_visual = Node3D.new()
	add_child(_visual)
	_visual.position = c + Vector3(0, 0.03, 0)
	_mat = StandardMaterial3D.new()
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.albedo_color = NEUTRAL
	var w := 0.16
	for e in [[Vector3(0, 0, -s.y * 0.5), Vector3(s.x + w, 0.05, w)], [Vector3(0, 0, s.y * 0.5), Vector3(s.x + w, 0.05, w)],
			[Vector3(-s.x * 0.5, 0, 0), Vector3(w, 0.05, s.y + w)], [Vector3(s.x * 0.5, 0, 0), Vector3(w, 0.05, s.y + w)]]:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = e[1]
		mi.mesh = b
		mi.position = e[0]
		mi.material_override = _mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_visual.add_child(mi)
	var fill := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = s
	fill.mesh = pm
	_fill = StandardMaterial3D.new()
	_fill.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_fill.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_fill.albedo_color = Color(NEUTRAL, 0.06)
	fill.material_override = _fill
	fill.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_visual.add_child(fill)
	_light = OmniLight3D.new()
	_light.position = Vector3(0, 3.5, 0)
	_light.omni_range = maxf(s.x, s.y) * 1.1
	_light.light_energy = 0.8
	_light.light_color = NEUTRAL
	_visual.add_child(_light)

## Whether a pet standing at `p` (feet) is on the slab.
func contains(p: Vector3) -> bool:
	return absf(p.x - center.x) <= size.x * 0.5 and absf(p.z - center.z) <= size.y * 0.5 \
		and p.y > center.y - 1.0 and p.y < center.y + 3.0

## {holder: team alone on the slab or -1, contested: both teams on it, counts: [corgis, cats]}.
func evaluate(pets: Array) -> Dictionary:
	var counts := [0, 0]
	for p in pets:
		if p.alive and contains(p.global_position):
			counts[p.team] += 1
	var holder := -1
	if counts[0] > 0 and counts[1] == 0:
		holder = 0
	elif counts[1] > 0 and counts[0] == 0:
		holder = 1
	return {"holder": holder, "contested": counts[0] > 0 and counts[1] > 0, "counts": counts}

func show_state(st: Dictionary, delta: float) -> void:
	_t += delta
	var c := NEUTRAL
	var e := 0.8
	if st.contested:
		c = CONTESTED.lerp(Color.WHITE, 0.5 + 0.5 * sin(_t * 12.0))
		e = 1.6
	elif int(st.holder) >= 0:
		c = T.TEAM_COLORS[int(st.holder)].lightened(0.2)
		e = 1.8
	_mat.albedo_color = c
	_fill.albedo_color = Color(c, 0.14 if (st.contested or int(st.holder) >= 0) else 0.06)
	_light.light_color = c
	_light.light_energy = e

func _physics_process(_d: float) -> void:
	if _probes <= 0:
		return
	_probes -= 1  # sit the read-out on the slab's real surface, whatever height the world gives it
	var q := PhysicsRayQueryParameters3D.create(center + Vector3(0, 4, 0), center + Vector3(0, -4, 0), T.L_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty():
		_visual.position.y = hit.position.y + 0.03
		_probes = 0

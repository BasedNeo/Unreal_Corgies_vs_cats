extends Node3D
## The one rifle (lane G-GAME): hitscan, full-auto. Fire rate, damage, spread, falloff and range are the TS default
## rifle (weapons.ts squeaker_rifle, see tuning.gd). `shoot(origin, dir, spread)` casts one ray against the world
## (layer 1) and pet hitboxes (layer 3), applies damage, and plays the muzzle flash, the tracer and the impact spark.

const T := preload("res://game/tuning.gd")
const Model := preload("res://game/pet_model.gd")

signal fired(result: Dictionary)

var pet: Node = null  # carrier (pet.gd); may be null in a test harness
var ammo: int = T.RIFLE.mag
var cooldown := 0.0
var reload_left := 0.0
var bloom := 0.0
var rng := RandomNumberGenerator.new()
var muzzle: Marker3D
var _flash: MeshInstance3D
var _light: OmniLight3D
var _tracer: MeshInstance3D
var _spark: MeshInstance3D
var _flash_t := 0.0
var _trace_t := 0.0

func setup(species: int, team: int, look: Node) -> void:
	var model := Model.rifle(species, team, look)
	add_child(model)
	muzzle = model.get_node("Muzzle")
	_flash = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.34, 0.34)
	_flash.mesh = q
	_flash.material_override = _fx_mat(Color(1.0, 0.82, 0.45), true)
	_flash.visible = false
	muzzle.add_child(_flash)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.75, 0.4)
	_light.light_energy = 2.2
	_light.omni_range = 4.0
	_light.visible = false
	muzzle.add_child(_light)
	_tracer = MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(1, 1, 1)
	_tracer.mesh = b
	_tracer.material_override = _fx_mat(Color(1.0, 0.9, 0.6), false)
	_tracer.top_level = true
	_tracer.visible = false
	add_child(_tracer)
	_spark = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.07
	s.height = 0.14
	s.radial_segments = 8
	s.rings = 4
	_spark.mesh = s
	_spark.material_override = _fx_mat(Color(1.0, 0.95, 0.7), false)
	_spark.top_level = true
	_spark.visible = false
	add_child(_spark)

func refill() -> void:
	ammo = T.RIFLE.mag
	cooldown = 0.0
	reload_left = 0.0
	bloom = 0.0

func reloading() -> bool:
	return reload_left > 0.0

func start_reload() -> void:
	if reload_left <= 0.0 and ammo < int(T.RIFLE.mag):
		reload_left = T.RIFLE.reload

func can_fire() -> bool:
	return cooldown <= 0.0 and reload_left <= 0.0 and ammo > 0

func _physics_process(delta: float) -> void:
	cooldown = maxf(cooldown - delta, -1.0 / float(T.RIFLE.fire_rate))
	bloom = maxf(0.0, bloom - float(T.RIFLE.bloom_recover) * delta)
	if reload_left > 0.0:
		reload_left -= delta
		if reload_left <= 0.0:
			reload_left = 0.0
			ammo = T.RIFLE.mag
	if _flash_t > 0.0:
		_flash_t -= delta
		if _flash_t <= 0.0:
			_flash.visible = false
			_light.visible = false
	if _trace_t > 0.0:
		_trace_t -= delta
		if _trace_t <= 0.0:
			_tracer.visible = false
			_spark.visible = false

## Fires once if the rifle is ready. Returns {} when it could not fire, else {hit, pos, target, damage, head, kill}.
func shoot(origin: Vector3, dir: Vector3, spread: float) -> Dictionary:
	if not can_fire():
		if ammo <= 0:
			start_reload()
		return {}
	# keep the exact 10 rps cadence even when a tick overshoots the interval
	cooldown += 1.0 / float(T.RIFLE.fire_rate)
	ammo -= 1
	var d := spread_dir(dir.normalized(), spread + bloom)
	bloom = minf(bloom + float(T.RIFLE.bloom_per_shot), float(T.RIFLE.bloom_max))
	var res := trace(origin, d)
	res["fired"] = true
	var target = res.get("target")
	if target != null:
		var from_pos: Vector3 = pet.global_position if pet != null else origin
		var dmg := damage_at(from_pos.distance_to(res.pos))
		if res.head:
			dmg *= float(T.RIFLE.head_mult)
		res["damage"] = dmg
		res["kill"] = target.take_damage(dmg, pet)
	_fx(res)
	if ammo <= 0:
		start_reload()
	if pet != null and pet.game != null:
		pet.game.on_shot(pet)
	fired.emit(res)
	return res

## One ray from `origin` along `dir`: world (layer 1) and pet hitboxes (layer 3). The carrier's own hitbox and its
## teammates' hitboxes are skipped (no friendly fire, a teammate never soaks a shot).
func trace(origin: Vector3, dir: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * float(T.RIFLE.range), T.RAY_MASK)
	q.collide_with_areas = true
	q.collide_with_bodies = true
	var ex: Array[RID] = []
	if pet != null:
		for p in pet.allies():
			ex.append(p.hitbox.get_rid())
	q.exclude = ex
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return {"hit": false, "pos": origin + dir * float(T.RIFLE.range), "target": null, "head": false, "damage": 0.0}
	var col: Object = hit.collider
	var target: Node = null
	var head := false
	if col != null and col.has_meta("pet"):
		target = col.get_meta("pet")
		if not target.alive:
			target = null
		else:
			head = hit.position.y - target.global_position.y > 0.8 * T.height(target.species)
	return {"hit": true, "pos": hit.position, "normal": hit.normal, "target": target, "head": head, "damage": 0.0}

static func damage_at(dist: float) -> float:
	var r := T.RIFLE
	var k := 1.0
	if dist > float(r.falloff_start):
		var t := clampf((dist - float(r.falloff_start)) / (float(r.falloff_end) - float(r.falloff_start)), 0.0, 1.0)
		k = lerpf(1.0, float(r.falloff_min), t)
	return float(r.damage) * k

## A direction inside a cone of half-angle `spread` around `dir`.
func spread_dir(dir: Vector3, spread: float) -> Vector3:
	if spread <= 0.0:
		return dir
	var ref := Vector3.UP if absf(dir.y) < 0.95 else Vector3.RIGHT
	var u := dir.cross(ref).normalized()
	var v := dir.cross(u).normalized()
	var a := spread * sqrt(rng.randf())
	var phi := rng.randf() * TAU
	return (dir * cos(a) + (u * cos(phi) + v * sin(phi)) * sin(a)).normalized()

func _fx(res: Dictionary) -> void:
	if muzzle == null:
		return
	_flash.visible = true
	_flash.rotation.z = rng.randf() * TAU
	_light.visible = true
	_flash_t = 0.05
	var a := muzzle.global_position
	var b: Vector3 = res.pos
	var len := a.distance_to(b)
	if len > 0.3:
		_tracer.visible = true
		var fwd := (b - a) / len
		var up := Vector3.UP if absf(fwd.y) < 0.95 else Vector3.RIGHT
		_tracer.global_transform = Transform3D(Basis.looking_at(fwd, up) * Basis.from_scale(Vector3(0.022, 0.022, len)), (a + b) * 0.5)
	if res.hit:
		_spark.visible = true
		_spark.global_position = b
	_trace_t = 0.045

static func _fx_mat(c: Color, additive: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.albedo_texture = _flash_tex()
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

static func _flash_tex() -> Texture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(0.5, 0.0)
	t.width = 32
	t.height = 32
	return t

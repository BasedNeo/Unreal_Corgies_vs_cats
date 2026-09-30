extends CharacterBody3D
## A pet in the match (lane G-GAME): the base of player.gd and bot.gd. One movement model for both (TS numbers,
## tuning.gd), a capsule collider on layer 2 (never the render mesh), a capsule hitbox on layer 3 for the rifle,
## hit points, death and respawn. The origin is at the feet. `yaw` is the facing (0 faces -Z); only the model turns.

const T := preload("res://game/tuning.gd")
const Model := preload("res://game/pet_model.gd")
const Rifle := preload("res://game/rifle.gd")

signal died(pet: Node, killer: Node)
signal damaged(amount: float, from: Node)

var team := 0
var species := 0
var display_name := "Pet"
var game: Node = null  # match.gd, null in a bare test harness
var look: Node = null
var debug_label := false
var hp: float = T.MAX_HP
var alive := true
var shield := 0.0
var yaw := 0.0
var aim_pitch := 0.0
var kills := 0
var deaths := 0
var m: Dictionary
var model: Node3D
var rifle: Node3D
var hitbox: Area3D
var _jump_buffer := 0.0
var _air_time := 0.0
var _jump_held := false

func configure(p_team: int, p_species: int, p_name: String, p_look: Node) -> void:
	team = p_team
	species = p_species
	display_name = p_name
	look = p_look

func _ready() -> void:
	m = T.MOVE[species]
	var h := T.height(species)
	collision_layer = T.L_PETS
	collision_mask = T.L_WORLD | T.L_PETS
	floor_snap_length = 0.35
	floor_max_angle = deg_to_rad(46.0)
	var cap := CapsuleShape3D.new()
	cap.radius = m.radius
	cap.height = h
	var cs := CollisionShape3D.new()
	cs.shape = cap
	cs.position.y = h * 0.5
	add_child(cs)
	hitbox = Area3D.new()
	hitbox.name = "Hitbox"
	hitbox.collision_layer = T.L_HITBOX
	hitbox.collision_mask = 0
	hitbox.monitoring = false
	hitbox.set_meta("pet", self)
	var hc := CapsuleShape3D.new()
	hc.radius = float(m.radius) + 0.04
	hc.height = h + 0.08
	var hs := CollisionShape3D.new()
	hs.shape = hc
	hs.position.y = h * 0.5
	hitbox.add_child(hs)
	add_child(hitbox)
	model = Model.build(species, team, look)
	add_child(model)
	rifle = Rifle.new()
	rifle.name = "Rifle"
	rifle.pet = self
	rifle.position = Vector3(0.27, 0.64, -0.3) if species == T.CORGI else Vector3(0.22, 0.76, -0.22)
	model.add_child(rifle)
	rifle.setup(species, team, look)
	if debug_label:
		var l := Label3D.new()
		l.text = "PLACEHOLDER\n" + display_name
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.font_size = 28
		l.pixel_size = 0.005
		l.modulate = T.TEAM_COLORS[team].lightened(0.4)
		l.position.y = h + 0.45
		l.no_depth_test = true
		add_child(l)

func eye() -> Vector3:
	return global_position + Vector3(0, T.height(species) * 0.78, 0)

func chest() -> Vector3:
	return global_position + Vector3(0, T.height(species) * 0.55, 0)

func allies() -> Array:
	if game == null:
		return [self]
	return game.pets.filter(func(p): return p.team == team)

## Shared movement (TS movement.ts, simplified): accelerate towards wish * speed on the ground, brake with the
## ground decel when there is no input, weaker air control, buffered + coyote jump, variable jump height, heavier fall.
func move_pet(wish: Vector3, speed: float, jump_pressed: bool, jump_down: bool, delta: float) -> void:
	var grounded := is_on_floor()
	var hv := Vector3(velocity.x, 0.0, velocity.z)
	var has_input := wish.length_squared() > 0.0025
	var accel: float = (m.accel if has_input else m.decel) if grounded else m.air
	hv = hv.move_toward(wish.limit_length(1.0) * speed, accel * delta)
	_air_time = 0.0 if grounded else _air_time + delta
	_jump_buffer = float(m.buffer) + delta if jump_pressed else maxf(0.0, _jump_buffer - delta)
	if _jump_buffer > 0.0 and (grounded or _air_time < float(m.coyote)):
		velocity.y = m.jump
		_jump_buffer = 0.0
		_air_time = m.coyote
		grounded = false
	if _jump_held and not jump_down and velocity.y > 0.0:
		velocity.y *= 0.5  # release early = shorter hop
	_jump_held = jump_down
	if not grounded:
		var g: float = T.GRAVITY * (float(m.fall_scale) if velocity.y < 0.0 else 1.0)
		velocity.y = maxf(-T.MAX_FALL, velocity.y - g * delta)
	velocity.x = hv.x
	velocity.z = hv.z
	move_and_slide()

func set_facing(p_yaw: float, p_pitch: float) -> void:
	yaw = p_yaw
	aim_pitch = p_pitch
	model.rotation.y = yaw
	rifle.rotation.x = clampf(aim_pitch, -0.9, 0.9)

## Returns true when this hit took the pet down.
func take_damage(amount: float, from: Node) -> bool:
	if not alive or shield > 0.0:
		return false
	if from != null and from != self and from.team == team:
		return false
	hp -= amount
	damaged.emit(amount, from)
	if hp <= 0.0:
		die(from)
		return true
	return false

func die(killer: Node) -> void:
	if not alive:
		return
	alive = false
	hp = 0.0
	deaths += 1
	if killer != null and killer != self:
		killer.kills += 1
	model.visible = false
	collision_layer = 0
	hitbox.collision_layer = 0
	velocity = Vector3.ZERO
	died.emit(self, killer)

func respawn(pos: Vector3, face_yaw: float) -> void:
	alive = true
	hp = T.MAX_HP
	shield = T.SPAWN_SHIELD
	global_position = pos
	velocity = Vector3.ZERO
	_jump_buffer = 0.0
	model.visible = true
	collision_layer = T.L_PETS
	hitbox.collision_layer = T.L_HITBOX
	rifle.refill()
	set_facing(face_yaw, 0.0)

func tick_common(delta: float) -> void:
	shield = maxf(0.0, shield - delta)

extends "res://game/pet.gd"
## The player (lane G-GAME): third-person boom camera over the right shoulder, WASD / left stick to move (camera
## relative, no auto-walk), mouse / right stick to look, Space / A to jump, hold LMB / RT to fire the rifle through
## the crosshair (a ray from the camera), RMB / LT to aim (tighter spread, zoom), Shift / L3 to sprint, R / X reload.
## Esc frees the mouse; a click captures it again (that click does not fire).

signal hit_confirmed(res: Dictionary)

const MOUSE_SENS := 0.0024
const PAD_YAW := 3.4
const PAD_PITCH := 2.3
const FOV := 72.0
const AIM_FOV := 50.0
const ARM := 3.2
const AIM_ARM := 2.1

var cam_yaw := 0.0
var cam_pitch := -0.14
var yaw_node: Node3D
var pitch_node: Node3D
var arm: SpringArm3D
var camera: Camera3D
var aiming := false
var using_pad := false
var kick_pitch := 0.0
var kick_yaw := 0.0
var _swallow_fire := false

func _ready() -> void:
	super._ready()
	yaw_node = Node3D.new()
	yaw_node.position.y = T.height(species) * 0.9
	add_child(yaw_node)
	pitch_node = Node3D.new()
	yaw_node.add_child(pitch_node)
	arm = SpringArm3D.new()
	arm.position = Vector3(0.72, 0.36, 0.0)
	arm.spring_length = ARM
	arm.collision_mask = T.L_WORLD
	var s := SphereShape3D.new()
	s.radius = 0.2
	arm.shape = s
	arm.add_excluded_object(get_rid())
	pitch_node.add_child(arm)
	camera = Camera3D.new()
	camera.fov = FOV
	camera.near = 0.05
	camera.far = 400.0
	arm.add_child(camera)
	camera.current = true
	damaged.connect(func(_a, _f): kick_pitch += randf_range(-0.012, 0.02); kick_yaw += randf_range(-0.015, 0.015))
	if DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func respawn(pos: Vector3, face_yaw: float) -> void:
	super.respawn(pos, face_yaw)
	cam_yaw = face_yaw
	cam_pitch = -0.14
	kick_pitch = 0.0
	kick_yaw = 0.0

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var k := 0.6 if aiming else 1.0
		cam_yaw -= e.relative.x * MOUSE_SENS * k
		cam_pitch = clampf(cam_pitch - e.relative.y * MOUSE_SENS * k, -1.25, 1.05)
		using_pad = false
	elif e.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		_swallow_fire = true
		using_pad = false
		get_viewport().set_input_as_handled()
	elif e is InputEventJoypadButton or (e is InputEventJoypadMotion and absf(e.axis_value) > 0.4):
		using_pad = true

func can_fire_input() -> bool:
	return using_pad or Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or DisplayServer.get_name() == "headless"

func _physics_process(delta: float) -> void:
	tick_common(delta)
	var playing: bool = game == null or game.playing()
	if not alive:
		_update_camera(delta)
		return
	var mv := Vector2.ZERO
	if playing:
		var lv := Input.get_vector("look_left", "look_right", "look_up", "look_down")
		if lv != Vector2.ZERO:
			var k := 0.5 if aiming else 1.0
			cam_yaw -= lv.x * absf(lv.x) * PAD_YAW * k * delta * 1.6
			cam_pitch = clampf(cam_pitch - lv.y * absf(lv.y) * PAD_PITCH * k * delta * 1.6, -1.25, 1.05)
		mv = Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	aiming = playing and Input.is_action_pressed("aim")
	var firing := playing and Input.is_action_pressed("fire") and can_fire_input() and not _swallow_fire
	if not Input.is_action_pressed("fire"):
		_swallow_fire = false
	var wish := Basis(Vector3.UP, cam_yaw) * Vector3(mv.x, 0.0, mv.y)
	var sprint := Input.is_action_pressed("sprint") and mv.y < -0.3 and not aiming and not firing
	var speed: float = m.walk if aiming else (m.sprint if sprint else m.run)
	move_pet(wish, speed, playing and Input.is_action_just_pressed("jump"), playing and Input.is_action_pressed("jump"), delta)
	set_facing(cam_yaw, cam_pitch)
	if playing and Input.is_action_just_pressed("reload"):
		rifle.start_reload()
	if firing:
		var res: Dictionary = rifle.shoot(camera.global_position, -camera.global_basis.z, current_spread())
		if not res.is_empty():
			kick_pitch += T.RIFLE.recoil_pitch
			kick_yaw += randf_range(-1.0, 1.0) * float(T.RIFLE.recoil_yaw)
			if res.target != null:
				hit_confirmed.emit(res)
	_update_camera(delta)

func current_spread() -> float:
	var r := T.RIFLE
	var base: float = r.spread_aim if aiming else r.spread_hip
	var hs := Vector2(velocity.x, velocity.z).length()
	base *= 1.0 + (float(r.move_mult) - 1.0) * clampf(hs / float(m.run), 0.0, 1.0)
	if not is_on_floor():
		base *= float(r.air_mult)
	return base

func _update_camera(delta: float) -> void:
	var settle := exp(-delta * 3.0 / float(T.RIFLE.recoil_recover))
	kick_pitch *= settle
	kick_yaw *= settle
	yaw_node.rotation.y = cam_yaw + kick_yaw
	pitch_node.rotation.x = cam_pitch + kick_pitch
	var f := 1.0 - exp(-14.0 * delta)
	camera.fov = lerpf(camera.fov, AIM_FOV if aiming else FOV, f)
	arm.spring_length = lerpf(arm.spring_length, AIM_ARM if aiming else ARM, f)

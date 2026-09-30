extends Node
## Input map, defined in code (lane G-GAME, autoload `GameInput`). Keyboard + mouse and gamepad share every action.
## Mouse look and the mouse capture live in player.gd; Esc (release_mouse) frees the mouse, a click captures it again.

const STICK_DEADZONE := 0.2

func _ready() -> void:
	_bind("move_forward", [KEY_W, KEY_UP], [], [[JOY_AXIS_LEFT_Y, -1.0]])
	_bind("move_back", [KEY_S, KEY_DOWN], [], [[JOY_AXIS_LEFT_Y, 1.0]])
	_bind("move_left", [KEY_A, KEY_LEFT], [], [[JOY_AXIS_LEFT_X, -1.0]])
	_bind("move_right", [KEY_D, KEY_RIGHT], [], [[JOY_AXIS_LEFT_X, 1.0]])
	_bind("look_left", [], [], [[JOY_AXIS_RIGHT_X, -1.0]])
	_bind("look_right", [], [], [[JOY_AXIS_RIGHT_X, 1.0]])
	_bind("look_up", [], [], [[JOY_AXIS_RIGHT_Y, -1.0]])
	_bind("look_down", [], [], [[JOY_AXIS_RIGHT_Y, 1.0]])
	_bind("jump", [KEY_SPACE], [JOY_BUTTON_A], [])
	_bind("fire", [], [JOY_BUTTON_RIGHT_SHOULDER], [[JOY_AXIS_TRIGGER_RIGHT, 1.0]], [MOUSE_BUTTON_LEFT])
	_bind("aim", [], [JOY_BUTTON_LEFT_SHOULDER], [[JOY_AXIS_TRIGGER_LEFT, 1.0]], [MOUSE_BUTTON_RIGHT])
	_bind("sprint", [KEY_SHIFT], [JOY_BUTTON_LEFT_STICK], [])
	_bind("reload", [KEY_R], [JOY_BUTTON_X], [])
	_bind("rematch", [KEY_R, KEY_ENTER], [JOY_BUTTON_START], [])
	_bind("release_mouse", [KEY_ESCAPE], [], [])
	_bind("toggle_mode", [KEY_F2], [JOY_BUTTON_BACK], [])

func _bind(action: String, keys: Array, buttons: Array, axes: Array, mouse: Array = []) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, STICK_DEADZONE)
	InputMap.action_erase_events(action)
	for k in keys:
		var e := InputEventKey.new()
		e.physical_keycode = k
		InputMap.action_add_event(action, e)
	for b in buttons:
		var e := InputEventJoypadButton.new()
		e.button_index = b
		InputMap.action_add_event(action, e)
	for a in axes:
		var e := InputEventJoypadMotion.new()
		e.axis = a[0]
		e.axis_value = a[1]
		InputMap.action_add_event(action, e)
	for m in mouse:
		var e := InputEventMouseButton.new()
		e.button_index = m
		InputMap.action_add_event(action, e)

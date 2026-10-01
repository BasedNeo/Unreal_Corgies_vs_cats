extends RefCounted
## Lead: the physical controls a stranger uses reach the actions the game reads. The game tests press actions
## (Input.action_press), so a broken binding would still pass them; this test builds the real key and mouse events
## and asks the InputMap (as set up by the GameInput autoload) which action each one triggers.

const KEYS := {
	"move_forward": [KEY_W, KEY_UP],
	"move_back": [KEY_S, KEY_DOWN],
	"move_left": [KEY_A, KEY_LEFT],
	"move_right": [KEY_D, KEY_RIGHT],
	"jump": [KEY_SPACE],
	"sprint": [KEY_SHIFT],
	"reload": [KEY_R],
	"rematch": [KEY_R, KEY_ENTER],
	"release_mouse": [KEY_ESCAPE],
	"toggle_mode": [KEY_F2],
}
const MOUSE := {"fire": MOUSE_BUTTON_LEFT, "aim": MOUSE_BUTTON_RIGHT}
const PAD := {"jump": JOY_BUTTON_A, "rematch": JOY_BUTTON_START}

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	if tree.root.get_node_or_null("GameInput") == null:
		return ["the GameInput autoload is missing (project.godot [autoload])"]
	for action in KEYS:
		if not InputMap.has_action(action):
			errs.append("no action '%s'" % action)
			continue
		for k in KEYS[action]:
			if not InputMap.event_is_action(_key(k), action, true):
				errs.append("%s does not trigger '%s'" % [OS.get_keycode_string(k), action])
	for action in MOUSE:
		if not InputMap.event_is_action(_mouse(MOUSE[action]), action, true):
			errs.append("mouse button %d does not trigger '%s'" % [MOUSE[action], action])
	for action in PAD:
		var e := InputEventJoypadButton.new()
		e.button_index = PAD[action]
		e.pressed = true
		if not InputMap.event_is_action(e, action, true):
			errs.append("pad button %d does not trigger '%s'" % [PAD[action], action])
	# No crossed wires: each movement key drives its own direction only, and Space only jumps.
	var moves := ["move_forward", "move_back", "move_left", "move_right"]
	for action in moves:
		for other in moves + ["jump", "fire"]:
			if other != action and InputMap.event_is_action(_key(KEYS[action][0]), other, true):
				errs.append("%s also triggers '%s'" % [OS.get_keycode_string(KEYS[action][0]), other])
	for other in moves + ["fire", "rematch"]:
		if InputMap.event_is_action(_key(KEY_SPACE), other, true):
			errs.append("Space also triggers '%s'" % other)
	return errs

func _key(k: Key) -> InputEventKey:
	var e := InputEventKey.new()
	e.physical_keycode = k
	e.pressed = true
	return e

func _mouse(b: MouseButton) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = b
	e.pressed = true
	return e

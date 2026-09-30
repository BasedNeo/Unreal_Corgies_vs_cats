extends RefCounted
## Support for the headless tests in tests/test_game_*.gd (lane G-GAME): boot main.tscn with match options, step
## physics frames, and catch every engine / script error raised meanwhile (the runner itself only sees the
## returned failure strings, so a test that errors out must report it).

class ErrLog extends Logger:
	var errors: PackedStringArray = []
	var _mx := Mutex.new()

	func _log_error(function: String, file: String, line: int, code: String, rationale: String, _notify: bool,
			error_type: int, _bt: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_WARNING:
			return
		_mx.lock()
		errors.append("%s:%d %s %s %s" % [file, line, function, code, rationale])
		_mx.unlock()

	func _log_message(_message: String, _error: bool) -> void:
		pass

static func watch() -> ErrLog:
	var l := ErrLog.new()
	OS.add_logger(l)
	return l

static func unwatch(l: ErrLog) -> Array:
	OS.remove_logger(l)
	var out: Array = []
	for e in l.errors:
		out.append("engine error: " + e)
	return out

## Instantiates main.tscn with `opts` merged into the match options and waits until the match is playing.
static func boot(tree: SceneTree, opts: Dictionary) -> Node:
	var main: Node = load("res://main.tscn").instantiate()
	var game: Node = main.get_node("Game")
	for k in opts:
		game.opts[k] = opts[k]
	tree.root.add_child(main)
	for i in 600:
		if game.playing():
			break
		await tree.process_frame
	return main

static func physics(tree: SceneTree, n: int) -> void:
	for i in n:
		await tree.physics_frame

static func dispose(tree: SceneTree, main: Node) -> void:
	for a in ["move_forward", "move_back", "move_left", "move_right", "jump", "fire", "rematch"]:
		Input.action_release(a)
	main.queue_free()
	await tree.process_frame
	await tree.process_frame

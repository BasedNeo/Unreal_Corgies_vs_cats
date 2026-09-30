extends SceneTree
## Headless test runner (lead): godot --headless --path engines/godot --script res://tests/run.gd
## Runs every res://tests/test_*.gd. Each test file extends RefCounted and has `func run(tree: SceneTree) -> Array`
## returning failure strings (empty = pass); it may `await` frames through the tree.
## W12: a test that fails to parse or to instantiate, or that returns anything but an Array (a script error returns
## null), is a FAIL; an engine or script error logged while a test runs is a FAIL (a runtime error aborts the test's
## function, which then returns its default, an empty Array, so the return value alone would read as a pass); a
## watchdog fails the whole run if it does not finish in WATCHDOG_S seconds (no silent hang).
const WATCHDOG_S := 600.0

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

func _init() -> void:
	_run.call_deferred()

func _watchdog() -> void:
	await create_timer(WATCHDOG_S, true, false, true).timeout
	print("FAIL watchdog: the suite did not finish in %d s (a test hung)" % int(WATCHDOG_S))
	print("GODOT TESTS: FAILED (watchdog)")
	quit(1)

func _run() -> void:
	_watchdog()
	var failed := 0
	var files := DirAccess.get_files_at("res://tests")
	files.sort()
	for f in files:
		if not (f.begins_with("test_") and f.ends_with(".gd")):
			continue
		var script = load("res://tests/" + f)
		if script == null or not (script is GDScript) or not script.can_instantiate():
			failed += 1
			print("FAIL ", f, ": does not load or instantiate (parse error?)")
			continue
		var t = script.new()
		if t == null or not t.has_method("run"):
			failed += 1
			print("FAIL ", f, ": no run(tree) method")
			continue
		var log := ErrLog.new()
		OS.add_logger(log)
		var errs = await t.run(self)
		OS.remove_logger(log)
		if typeof(errs) == TYPE_ARRAY and not log.errors.is_empty():
			errs = errs.duplicate()
			for e in log.errors:
				errs.append("engine error: " + e)
		if typeof(errs) != TYPE_ARRAY:
			failed += 1
			print("FAIL ", f, ": run() returned ", type_string(typeof(errs)), " (a script error?)")
		elif errs.is_empty():
			print("PASS ", f)
		else:
			failed += 1
			for e in errs:
				print("FAIL ", f, ": ", e)
	print("GODOT TESTS: ", "PASS" if failed == 0 else "%d FAILED" % failed)
	quit(0 if failed == 0 else 1)

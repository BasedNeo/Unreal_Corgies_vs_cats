extends SceneTree
## Headless test runner (lead): godot --headless --path engines/godot --script res://tests/run.gd
## Runs every res://tests/test_*.gd. Each test file extends RefCounted and has `func run(tree: SceneTree) -> Array`
## returning failure strings (empty = pass); it may `await` frames through the tree.
func _init() -> void:
	_run.call_deferred()

func _run() -> void:
	var failed := 0
	var files := DirAccess.get_files_at("res://tests")
	files.sort()
	for f in files:
		if not (f.begins_with("test_") and f.ends_with(".gd")):
			continue
		var t = load("res://tests/" + f).new()
		var errs: Array = await t.run(self)
		if errs.is_empty():
			print("PASS ", f)
		else:
			failed += 1
			for e in errs:
				print("FAIL ", f, ": ", e)
	print("GODOT TESTS: ", "PASS" if failed == 0 else "%d FAILED" % failed)
	quit(0 if failed == 0 else 1)

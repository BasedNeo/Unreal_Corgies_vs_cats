extends Node
## Proof autoload (lead): `-- --shot <png> [--frames N] [--cam x,y,z:tx,ty,tz]` saves the viewport after N rendered
## frames (default 90) and quits. With --cam the shot is taken from that camera instead of the game's.
var _shot := ""
var _frames := 90
var _cam := ""
var _n := 0

func _ready() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		match a[i]:
			"--shot": _shot = a[i + 1] if i + 1 < a.size() else ""
			"--frames": _frames = int(a[i + 1]) if i + 1 < a.size() else _frames
			"--cam": _cam = a[i + 1] if i + 1 < a.size() else ""
	set_process(_shot != "")

func _process(_d: float) -> void:
	_n += 1
	if _n == _frames - 5 and _cam != "":
		var parts := _cam.split(":")
		var p := parts[0].split_floats(","); var t := parts[1].split_floats(",")
		var c := Camera3D.new(); get_tree().root.add_child(c)
		c.look_at_from_position(Vector3(p[0], p[1], p[2]), Vector3(t[0], t[1], t[2])); c.current = true
	if _n < _frames:
		return
	var img := get_viewport().get_texture().get_image()
	var path := _shot if _shot.is_absolute_path() else ProjectSettings.globalize_path("res://").path_join("../..").path_join(_shot)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var err := img.save_png(path)
	print("PROOF shot %s (%dx%d) err=%d adapter=%s" % [path, img.get_width(), img.get_height(), err, RenderingServer.get_video_adapter_name()])
	get_tree().quit(0 if err == OK else 1)

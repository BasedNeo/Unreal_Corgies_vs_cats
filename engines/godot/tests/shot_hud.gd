extends SceneTree
## W15 G-HUD screenshots (lane G-HUD). Not a test: tests/run.gd only runs test_*.gd. It boots main.tscn, stages each HUD
## state with the bots frozen where it puts them, renders it and saves docs/qa/w15/hud-godot-<name>.jpg (at most
## MAX_BYTES), plus greyscale copies (-gray.jpg, Rec. 709 luma) of the marker and hit shots: they must read without
## colour. Run it rendered, one Godot at a time:
##   xvfb-run -a -s "-screen 0 1280x720x24" godot --path engines/godot --rendering-method gl_compatibility \
##     --rendering-driver opengl3 --audio-driver Dummy --script res://tests/shot_hud.gd -- --out docs/qa/w15
## `--only <name>` takes the shots whose name contains <name>. Shots (a 2v2 with the human; marker-near is --lineup 30):
## - marker-corgi: the play camera at the Corgis' middle respawn point, as a respawn leaves it (facing the slab, pitch
##   -0.14 rad), the two Cat bots on the slab, the Corgi bot beside the human.
## - marker-cat: the same at the Cats' middle respawn point (the human stands in for a Cat), the Corgi bot alone on the
##   slab, the Cat bots beside the human.
## - marker-near: --lineup 30, a Corgi bot and a Cat bot on the slab, the marker over them.
## - death: the Cat bot has just taken the player down.
## - hits: the body, head, kill and received cues at the crosshair, side by side at 1.5x (the captions are this
##   harness's). The human faces away from the slab, at a Cat bot 12 m off.
## - hit-received: that whole screen after a hit from a Cat bot behind on the right: the wedge, the HP chip and the red
##   flash; the slab is behind, so the marker sits on the bottom edge.
## - win: the winner screen at 60-41; the slab line and the marker are gone.
## Time is frozen (Engine.time_scale 0) before a cue is staged, so it is drawn at its first frame's strength.

const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const MAX_BYTES := 250 * 1024
const CROP := 300
const ZOOM := 1.5

var out_dir := "docs/qa/w15"
var only := ""
var _caption: Label
var _failed := 0

func _init() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		if a[i] == "--out" and i + 1 < a.size():
			out_dir = a[i + 1]
		elif a[i] == "--only" and i + 1 < a.size():
			only = a[i + 1]
	_run.call_deferred()

func _want(name: String) -> bool:
	return only == "" or only in name

func _run() -> void:
	if DisplayServer.get_name() == "headless":
		print("SHOT shot_hud.gd needs a display (xvfb-run) and a renderer")
		quit(1)
		return
	var layer := CanvasLayer.new()
	layer.layer = 20
	root.add_child(layer)
	_caption = Label.new()
	_caption.add_theme_font_size_override("font_size", 15)
	_caption.add_theme_color_override("font_color", Color(0.75, 0.78, 0.82))
	_caption.add_theme_color_override("font_outline_color", Color.BLACK)
	_caption.add_theme_constant_override("outline_size", 4)
	_caption.visible = false
	layer.add_child(_caption)
	var main: Node = await Kit.boot(self, {"human": true, "allies": 1, "enemies": 2, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null:
		print("SHOT the 2v2 did not start")
		quit(1)
		return
	for p in game.pets:
		if p != game.player:
			p.set_physics_process(false)
	if _want("marker-corgi"):
		await _marker_base(game, 0, "marker-corgi")
	if _want("marker-cat"):
		await _marker_base(game, 1, "marker-cat")
	if _want("death"):
		await _death(game)
	if _want("hits") or _want("hit-received"):
		await _hits(game)
	if _want("win"):
		await _win(game)
	Engine.time_scale = 1.0
	await Kit.dispose(self, main)
	if _want("marker-near"):
		var lineup: Node = await Kit.boot(self, {"lineup": 30.0})
		var g2: Node = lineup.get_node("Game")
		await _settle(g2, 40)
		await _freeze()
		_report("marker-near", g2)
		await _save("marker-near", await _frame(), true)
		Engine.time_scale = 1.0
		await Kit.dispose(self, lineup)
	print("SHOT done, %d failed" % _failed)
	quit(0 if _failed == 0 else 1)

# --- staging -----------------------------------------------------------------------------------------------------

## The ground under `at` (a ray on the world layer), 5 cm up.
func _ground(game: Node, at: Vector3) -> Vector3:
	var space: PhysicsDirectSpaceState3D = game.player.get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(at + Vector3(0, 30, 0), at - Vector3(0, 30, 0), T.L_WORLD)
	var hit := space.intersect_ray(q)
	return (hit.position if not hit.is_empty() else at) + Vector3(0, 0.05, 0)

## The human at `at`, facing `look`. With `lift` the camera is pitched so the crosshair sits `lift` m over `look`;
## without, it keeps the respawn's pitch.
func _stand(game: Node, at: Vector3, look: Vector3, lift := NAN) -> void:
	var me: Node = game.player
	var pos := _ground(game, at)
	me.respawn(pos, atan2(-(look.x - pos.x), -(look.z - pos.z)))
	if not is_nan(lift):
		var pivot := pos + Vector3(0, 1.45, 0)
		me.cam_pitch = atan2(look.y + lift - pivot.y, Vector2(look.x - pivot.x, look.z - pivot.z).length())

## Runs `n` physics frames at normal speed: the boom, the spring arm and the field of view settle; the slab state and
## the HUD catch up. The controls hint (the first 14 s of a match only) is put away.
func _settle(game: Node, n: int) -> void:
	Engine.time_scale = 1.0
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	for i in n:
		await physics_frame
	game.hud._hint_t = 0.0
	await process_frame
	await process_frame

## Stops time: after these two frames every _process gets delta 0, so what is staged next holds still.
func _freeze() -> void:
	Engine.time_scale = 0.0
	await process_frame
	await process_frame

## Lets two frames draw and returns the screen.
func _frame() -> Image:
	await process_frame
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := root.get_texture().get_image()
	img.convert(Image.FORMAT_RGB8)
	return img

func _report(name: String, game: Node) -> void:
	var mk: Dictionary = game.hud.marker
	print("SHOT %s: marker %s %s, lift %.1f px, shape at %s" % [name, str(mk.get("lines", [])), "shown" if mk.get("visible", false)
		else "hidden", float(mk.get("lift", 0.0)), str(mk.get("pos", "-"))])

func _marker_base(game: Node, team: int, name: String) -> void:
	var c: Vector3 = game.slab.center
	var me: Node = game.player
	var bots: Array = game.pets.filter(func(p): return p != me)
	var corgi: Node = bots.filter(func(p): return p.team == 0)[0]
	var cats: Array = bots.filter(func(p): return p.team == 1)
	var slots: Array = game.respawn_slots[team]
	var sp: Vector3 = slots[int(slots.size() / 2.0)]
	_stand(game, sp, c)
	var view := Vector3(c.x - sp.x, 0.0, c.z - sp.z).normalized()
	var across := Vector3(-view.z, 0.0, view.x)
	if team == 0:  # the Cats hold the slab; the Corgi bot waits by the human
		cats[0].global_position = _ground(game, c + across * 1.2)
		cats[1].global_position = _ground(game, c - across * 1.2)
		corgi.global_position = _ground(game, sp + view * 4.0 - across * 2.5)
	else:  # the Corgi bot holds it alone; the Cat bots wait by the human
		corgi.global_position = _ground(game, c)
		cats[0].global_position = _ground(game, sp + view * 4.0 - across * 2.5)
		cats[1].global_position = _ground(game, sp + view * 7.0 + across * 3.0)
	await _settle(game, 40)
	await _freeze()
	_report(name, game)
	await _save(name, await _frame(), true)

func _death(game: Node) -> void:
	var c: Vector3 = game.slab.center
	var me: Node = game.player
	var cat: Node = game.pets.filter(func(p): return p.team == 1)[0]
	for p in game.pets:
		if p != me:
			p.global_position = _ground(game, c + Vector3(5.0 * p.get_index(), 0, 40))
	_stand(game, c + Vector3(-14.0, 0, -22.0), c, 1.0)
	cat.global_position = _ground(game, c + Vector3(-6.0, 0, -9.0))
	await _settle(game, 30)
	me.die(cat)
	while game.respawn_left(me) > 2.5:
		await physics_frame
	await _freeze()
	_report("death", game)
	print("SHOT death: %s" % str(game.hud.death_text))
	await _save("death", await _frame(), false)
	Engine.time_scale = 1.0
	while not me.alive:
		await physics_frame

func _hits(game: Node) -> void:
	var c: Vector3 = game.slab.center
	var me: Node = game.player
	var cats: Array = game.pets.filter(func(p): return p.team == 1)
	var target: Node = cats[0]
	var at := _ground(game, c + Vector3(-10.0, 0, -16.0))
	var away := Vector3(at.x - c.x, 0.0, at.z - c.z).normalized()
	var tpos := _ground(game, at + away * 12.0)
	target.global_position = tpos
	_stand(game, at, tpos, 0.55)
	await _settle(game, 30)
	# the camera rides 0.72 m right of the pet: turn until its own line of sight, not the pet's, meets the target's chest
	for i in 3:
		var to: Vector3 = target.chest() - me.camera.global_position
		me.cam_yaw = atan2(-to.x, -to.z)
		me.cam_pitch = atan2(to.y, Vector2(to.x, to.z).length())
		await _settle(game, 4)
	var cells: Array = []
	var kinds := [["BODY", {"kill": false, "head": false}], ["HEAD", {"kill": false, "head": true}],
		["KILL", {"kill": true, "head": false}]]
	for k in kinds:
		await _settle(game, 2)
		await _freeze()
		var res: Dictionary = k[1].duplicate()
		res.merge({"hit": true, "target": target, "pos": target.chest(), "damage": 15.0, "fired": true})
		me.hit_confirmed.emit(res)
		cells.append(await _cell(k[0]))
	# received: a Cat bot behind on the right fires; the last confirm has faded
	await _settle(game, 30)
	var cam: Camera3D = me.camera
	var right := Vector3(cam.global_basis.x.x, 0.0, cam.global_basis.x.z).normalized()
	var back := Vector3(cam.global_basis.z.x, 0.0, cam.global_basis.z.z).normalized()
	cats[1].global_position = _ground(game, me.global_position + right * 9.0 + back * 6.0)
	await _freeze()
	me.shield = 0.0
	me.take_damage(15.0, cats[1])
	cells.append(await _cell("RECEIVED"))
	if _want("hit-received"):
		_report("hit-received", game)
		await _save("hit-received", await _frame(), true)
	if _want("hits"):
		var w := int(CROP * ZOOM)
		var sheet := Image.create(w * 2 + 6, w * 2 + 6, false, Image.FORMAT_RGB8)
		sheet.fill(Color(0.12, 0.12, 0.14))
		for i in cells.size():
			var im: Image = cells[i]
			im.resize(w, w, Image.INTERPOLATE_NEAREST)
			sheet.blit_rect(im, Rect2i(0, 0, w, w), Vector2i((i % 2) * (w + 6), int(i / 2.0) * (w + 6)))
		await _save("hits", sheet, true)
	Engine.time_scale = 1.0

## One cue as staged: the CROP px square around the crosshair (the screen's centre), captioned in its corner by this
## harness.
func _cell(caption: String) -> Image:
	var mid := root.get_visible_rect().get_center()
	_caption.text = caption
	_caption.position = mid - Vector2(CROP, CROP) * 0.5 + Vector2(8, 4)
	_caption.visible = true
	var img := await _frame()
	_caption.visible = false
	var half := Vector2i(CROP, CROP) / 2
	return img.get_region(Rect2i(Vector2i(img.get_width(), img.get_height()) / 2 - half, Vector2i(CROP, CROP)))

func _win(game: Node) -> void:
	await _settle(game, 45)  # 0.75 s: an earlier shot's wedge (0.6 s) and HP chip (0.4 s) fade first
	game.score = [60, 41]
	game.end_match(0)
	await _freeze()
	_report("win", game)
	await _save("win", await _frame(), false)
	Engine.time_scale = 1.0

# --- output ------------------------------------------------------------------------------------------------------

func _save(name: String, img: Image, gray: bool) -> void:
	_write("hud-godot-%s.jpg" % name, img)
	if gray:
		_write("hud-godot-%s-gray.jpg" % name, _luma(img))
	await process_frame

func _write(file: String, img: Image) -> void:
	var dir := out_dir if out_dir.is_absolute_path() else ProjectSettings.globalize_path("res://").path_join("../..").path_join(out_dir)
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.simplify_path().path_join(file)
	var q := 0.9
	var buf := img.save_jpg_to_buffer(q)
	while buf.size() > MAX_BYTES and q > 0.35:
		q -= 0.05
		buf = img.save_jpg_to_buffer(q)
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null or buf.size() > MAX_BYTES:
		_failed += 1
		print("SHOT FAIL %s (%d bytes)" % [path, buf.size()])
		return
	f.store_buffer(buf)
	f.close()
	print("SHOT %s %dx%d %d KB q%.2f" % [path, img.get_width(), img.get_height(), buf.size() / 1024, q])

## A greyscale copy: Rec. 709 luma of the sRGB values.
static func _luma(img: Image) -> Image:
	var data := img.get_data()
	for i in range(0, data.size(), 3):
		var y := int(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] + 0.5)
		data[i] = y
		data[i + 1] = y
		data[i + 2] = y
	return Image.create_from_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGB8, data)

extends RefCounted
## W15 G-HUD §3 and §4 (docs/qa/w15/HUD_CONTRACT.md): hit cues and the HUD fields.
## 1. Pure (hud.gd hit_cue): body, head, kill and received differ in shape, not only colour: body an X of four lines;
##    head the X and a small filled diamond on the crosshair; kill a larger X and an outline ring about 18 px across;
##    received a filled triangle about HIT_RING (110) px out, its tip along the attacker's direction, longer than wide.
## 2. Pure (wedge_dir): an attacker ahead, right, behind and left of the camera's facing points the wedge up, right,
##    down and left; the camera's pitch does not change it, its yaw does.
## 3. A 1v1 match: hit_confirmed shows the body, head and kill cue. A hit from the Cat bot on the player's right adds a
##    wedge pointing right (behind: down), a white chip on the HP bar exactly the HP lost that drains away within
##    CHIP_DRAIN s, and the red flash, never above FLASH_MAX alpha; the wedge fades out within WEDGE_FADE s. When the
##    attacker then moves to the player's left, the wedge keeps pointing right: it holds the position at the hit.
## 4. Fields: `YOU: CORGI COMPANY` over the HP bar; no fps line anywhere; the strings at the match's start
##    (`CORGI COMPANY  0`, `0  CAT CADRE`, `SLAB  NEUTRAL`, `30 / 30`, `120`, the hint, the tag, the timer as m:ss) and
##    on the win screen (`CORGI COMPANY WINS`, the sub's first line and the rematch line). The other states' strings
##    (timer red, OVERTIME, HOLDING, CONTESTED, RELOADING, DRAW, the full win sub) are not tested here (Sprint C).
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")
const Marker := preload("res://tests/test_hud_marker.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	errs.append_array(_cues())
	errs.append_array(_wedge_dirs())
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("1v1 with the human did not start")
	else:
		errs.append_array(await _fields(tree, game))
		errs.append_array(await _live_cues(tree, game))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## The farthest any point of a cue reaches from `c` (a ring counts its radius).
static func reach(pr: Dictionary, c: Vector2) -> float:
	var r := 0.0
	for l in pr.lines:
		r = maxf(r, maxf(c.distance_to(l[0]), c.distance_to(l[1])))
	for f in pr.fills + pr.outlines:
		for q in f:
			r = maxf(r, c.distance_to(q))
	for g in pr.rings:
		r = maxf(r, c.distance_to(g[0]) + float(g[1]))
	return r

func _cues() -> Array:
	var e: Array = []
	var c := Vector2(640, 360)
	var body: Dictionary = Hud.hit_cue("body", c)
	var head: Dictionary = Hud.hit_cue("head", c)
	var kill: Dictionary = Hud.hit_cue("kill", c)
	var got: Dictionary = Hud.hit_cue("received", c, Vector2(1, 0))
	var sig := {}
	for k in ["body", "head", "kill", "received"]:
		sig[k] = Marker.signature(Hud.hit_cue(k, c, Vector2(1, 0)))
	for a in sig:
		for b in sig:
			if a < b and sig[a] == sig[b]:
				e.append("hit cues %s and %s have the same shape (%s): they differ only in colour" % [a, b, sig[a]])
	# body: an X of four lines, nothing else
	if body.lines.size() != 4 or not body.fills.is_empty() or not body.rings.is_empty() or not _is_x(body.lines, c):
		e.append("body confirm is not an X of four lines: %s" % sig.body)
	# head: the same X plus a small filled diamond on the crosshair
	if head.lines.size() != 4 or head.fills.size() != 1 or head.fills[0].size() != 4 or not head.rings.is_empty():
		e.append("head confirm is not the X with a filled diamond: %s" % sig.head)
	elif _centroid(head.fills[0]).distance_to(c) > 0.5 or reach({"lines": [], "fills": head.fills, "outlines": [], "rings": []}, c) > 6.0:
		e.append("head confirm: the diamond is not small and on the crosshair")
	# kill: a larger X and a ring about 18 px across
	if kill.lines.size() != 4 or kill.rings.size() != 1 or not kill.fills.is_empty() or not _is_x(kill.lines, c):
		e.append("kill confirm is not an X with a ring: %s" % sig.kill)
	else:
		var across := 2.0 * float(kill.rings[0][1])
		var ring_c: Vector2 = kill.rings[0][0]
		if absf(across - 18.0) > 3.0 or ring_c.distance_to(c) > 0.5:
			e.append("kill ring is %.1f px across (want about 18), centred %s" % [across, str(kill.rings[0][0])])
		if reach({"lines": kill.lines, "fills": [], "outlines": [], "rings": []}, c) < reach(body, c) + 4.0:
			e.append("the kill X (%.1f px) is not larger than the body X (%.1f px)" % [reach(kill, c), reach(body, c)])
	# received: one filled triangle on a ring about 110 px out, tip along the attacker's direction
	for d in [Vector2(1, 0), Vector2(0, -1), Vector2(-0.6, 0.8)]:
		var w: Dictionary = Hud.hit_cue("received", c, d)
		if not w.lines.is_empty() or not w.rings.is_empty() or w.fills.size() != 1 or w.fills[0].size() != 3:
			e.append("received cue is not one filled triangle: %s" % Marker.signature(w))
			continue
		var tri: PackedVector2Array = w.fills[0]
		var mid := _centroid(tri)
		var tip := tri[0]
		for q in tri:
			if c.distance_to(q) > c.distance_to(tip):
				tip = q
		if absf(mid.distance_to(c) - Hud.HIT_RING) > 15.0:
			e.append("received wedge sits %.1f px from the crosshair (want about %.0f)" % [mid.distance_to(c), Hud.HIT_RING])
		if (tip - mid).normalized().dot(d) < 0.99 or (mid - c).normalized().dot(d) < 0.99:
			e.append("received wedge for direction %s points %s" % [str(d), str((tip - mid).normalized())])
		# longer than wide, or a near-equilateral triangle shows a corner pointing elsewhere (W15: one read as 'up')
		var others: Array = Array(tri).filter(func(q): return q != tip)
		var b0: Vector2 = others[0]
		var b1: Vector2 = others[1]
		var width := b0.distance_to(b1)
		var length := tip.distance_to((b0 + b1) * 0.5)
		if length < 1.3 * width:
			e.append("received wedge %.1f px long, %.1f px wide: its tip does not read (want >= 1.3x)" % [length, width])
	if got.fills.is_empty():
		e.append("received cue has no wedge")
	return e

func _wedge_dirs() -> Array:
	var e: Array = []
	var me := Vector3(5, 0, 5)
	var cams := {"level, facing -Z": Transform3D(Basis(), me + Vector3(0.7, 1.8, 3.2)),
		"pitched down 60 deg": Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-60.0)), me + Vector3(0.7, 4.0, 2.0))}
	var cases := {"ahead": [Vector3(0, 0, -20), Vector2(0, -1)], "right": [Vector3(20, 0, 0), Vector2(1, 0)],
		"behind": [Vector3(0, 1, 20), Vector2(0, 1)], "left": [Vector3(-20, 2, 0), Vector2(-1, 0)]}
	for cn in cams:
		for k in cases:
			var d: Vector2 = Hud.wedge_dir(cams[cn], me, me + cases[k][0])
			if d.dot(cases[k][1]) < 0.99:
				e.append("camera %s, attacker %s: wedge points %s, want %s" % [cn, k, str(d), str(cases[k][1])])
	# turned 90 deg to the left (facing -X): an attacker at -X is ahead
	var turned := Transform3D(Basis(Vector3.UP, PI * 0.5), me + Vector3(3, 1.8, 0))
	var d2: Vector2 = Hud.wedge_dir(turned, me, me + Vector3(-20, 0, 0))
	if d2.dot(Vector2(0, -1)) < 0.99:
		e.append("camera facing -X, attacker at -X: wedge points %s, want up" % str(d2))
	return e

func _fields(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	await tree.process_frame
	await tree.process_frame
	var you: Label = hud._you
	var bar: Rect2 = hud._hp_bg.get_global_rect()
	var yr := you.get_global_rect()
	if not you.is_visible_in_tree() or you.text != "YOU: CORGI COMPANY":
		e.append("the team field reads '%s' (visible %s), want YOU: CORGI COMPANY" % [you.text, you.is_visible_in_tree()])
	if yr.end.y > bar.position.y + 0.5 or yr.end.y < bar.position.y - 30.0 or yr.position.x < bar.position.x - 0.5 \
			or yr.end.x > bar.end.x + 0.5:
		e.append("the team field %s is not over the HP bar %s" % [str(yr), str(bar)])
	var texts := PackedStringArray()
	for l in hud.find_children("*", "Label", true, false):
		texts.append((l as Label).text)
		if (l as Label).text.to_lower().contains("fps"):
			e.append("an fps line: %s" % (l as Label).text)
	var want := ["CORGI COMPANY  0", "0  CAT CADRE", "SLAB  NEUTRAL", "30 / 30", "PLACEHOLDER PETS", "120",
		"WASD / stick move · mouse / stick look · Space / A jump · LMB / RT fire · RMB / LT aim · Shift sprint · R reload\n"
		+ "Hold the slab alone to score · Esc frees the mouse · F2 / Back: 1v1 or 2v2"]
	for w in want:
		if not texts.has(w):
			e.append("the HUD lost the string %s" % w.c_escape())
	var timer: String = hud._timer.text
	var rx := RegEx.create_from_string("^[0-3]:[0-5][0-9]$")
	if rx.search(timer) == null:
		e.append("the timer reads %s, want m:ss" % timer)
	# the win screen's strings
	game.score = [60, 41]
	game.end_match(0)
	await tree.process_frame
	await tree.process_frame
	var sub: String = hud._win_sub.text
	if hud._win_title.text != "CORGI COMPANY WINS" or not sub.begins_with("60  –  41\nYou: ") \
			or not sub.ends_with("\n\nR / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2"):
		e.append("win screen reads %s / %s" % [hud._win_title.text, sub.c_escape()])
	game.rematch()
	await tree.process_frame
	await tree.process_frame
	return e

func _live_cues(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var cat: Node = game.pets[1]
	cat.set_physics_process(false)
	await Kit.physics(tree, 5)
	# confirms
	for row in [[{"kill": false, "head": false}, "body"], [{"kill": false, "head": true}, "head"], [{"kill": true, "head": true}, "kill"]]:
		var res: Dictionary = row[0].duplicate()
		res.merge({"hit": true, "target": cat, "pos": cat.global_position, "damage": 15.0})
		me.hit_confirmed.emit(res)
		await tree.process_frame
		await tree.process_frame
		if hud.hit_kind != row[1] or hud.hit_t <= 0.0:
			e.append("hit_confirmed %s shows the %s cue (%.2f s left), want %s" % [str(row[0]), hud.hit_kind, hud.hit_t, row[1]])
	# received from the right of the camera's facing, then from behind
	var cam: Camera3D = me.camera
	var right := Vector3(cam.global_basis.x.x, 0.0, cam.global_basis.x.z).normalized()
	var fwd := Vector3(-cam.global_basis.z.x, 0.0, -cam.global_basis.z.z).normalized()
	for side in [["right", right, Vector2(1, 0)], ["behind", -fwd, Vector2(0, 1)]]:
		hud.wedges.clear()
		await tree.create_timer(0.5).timeout  # the last chip drains
		cat.global_position = me.global_position + side[1] * 9.0
		me.shield = 0.0
		var hp0: float = me.hp
		me.take_damage(15.0, cat)
		await tree.process_frame
		await tree.process_frame
		if hud.wedges.size() != 1:
			e.append("a hit from the %s: %d wedges, want 1" % [side[0], hud.wedges.size()])
		else:
			var d: Vector2 = hud.wedge_screen_dir(hud.wedges[0])
			if d.dot(side[2]) < 0.95:
				e.append("a hit from the %s: the wedge points %s, want %s" % [side[0], str(d), str(side[2])])
		var lost := hp0 - float(me.hp)
		var chip: ColorRect = hud._chip
		var want_w := Hud.HP_W * lost / float(T.MAX_HP)
		if not chip.is_visible_in_tree() or chip.size.x > want_w + 0.5 or chip.size.x < want_w * 0.75 \
				or absf(chip.position.x - Hud.HP_W * float(me.hp) / float(T.MAX_HP)) > 0.5 or chip.color.v < 0.95 or chip.color.s > 0.05:
			e.append("a hit of %.0f HP: chip shown %s at x %.1f, %.1f px wide, colour %s (want shown, white, about %.1f px wide, from x %.1f)" % [
				lost, chip.is_visible_in_tree(), chip.position.x, chip.size.x, chip.color.to_html(false), want_w,
				Hud.HP_W * float(me.hp) / float(T.MAX_HP)])
		var a: float = hud._flash.color.a
		if a <= 0.0 or a > Hud.FLASH_MAX:
			e.append("a hit: the red flash alpha %.3f (want > 0 and <= %.2f)" % [a, Hud.FLASH_MAX])
		# contract §3: the wedge holds where the attacker stood at the hit; it never follows the attacker afterwards
		if side[0] == "right" and hud.wedges.size() == 1:
			var pos0: Vector3 = hud.wedges[0].pos
			cat.global_position = me.global_position - right * 9.0
			await tree.process_frame
			await tree.process_frame
			var held: Vector2 = hud.wedge_screen_dir(hud.wedges[0])
			if hud.wedges.is_empty() or hud.wedges[0].pos != pos0 or held.dot(Vector2.RIGHT) <= 0.95:
				e.append("the attacker moved to the left after its hit: the wedge points %s (want still right, from %s)" % [
					str(held), str(pos0)])
	await tree.create_timer(Hud.CHIP_DRAIN + 0.05).timeout
	await tree.process_frame
	if hud._chip.is_visible_in_tree() and hud._chip.size.x > 0.5:
		e.append("the chip is still %.1f px wide %.2f s after the hit" % [hud._chip.size.x, Hud.CHIP_DRAIN + 0.05])
	await tree.create_timer(Hud.WEDGE_FADE - Hud.CHIP_DRAIN + 0.05).timeout
	await tree.process_frame
	if not hud.wedges.is_empty():
		e.append("the wedge has not faded %.2f s after the hit" % (Hud.WEDGE_FADE + 0.1))
	# the flash cap holds for any flash length
	hud._dmg_t = 3.0
	await tree.process_frame
	await tree.process_frame
	if hud._flash.color.a > Hud.FLASH_MAX + 1e-6:
		e.append("the red flash reaches alpha %.2f (cap %.2f)" % [hud._flash.color.a, Hud.FLASH_MAX])
	return e

## Four lines from near `c` outward along the four diagonals (an X).
static func _is_x(lines: Array, c: Vector2) -> bool:
	var dirs := {}
	for l in lines:
		var a: Vector2 = l[0]
		var b: Vector2 = l[1]
		var d := (b - a).normalized()
		if absf(absf(d.x) - absf(d.y)) > 0.01 or c.distance_to(b) <= c.distance_to(a) or (a - c).normalized().dot(d) < 0.99:
			return false
		dirs[Vector2(signf(d.x), signf(d.y))] = true
	return dirs.size() == 4

static func _centroid(p: PackedVector2Array) -> Vector2:
	var s := Vector2.ZERO
	for q in p:
		s += q
	return s / float(p.size())

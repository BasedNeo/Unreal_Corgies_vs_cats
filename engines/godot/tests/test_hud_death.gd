extends RefCounted
## W15 G-HUD §2 (docs/qa/w15/HUD_CONTRACT.md): the death panel.
## 1. Pure (hud.gd death_lines, team_glyph): with a killer, `TAKEN DOWN BY <name>  ·  <TEAM>`; with none, `TAKEN DOWN BY
##    THE LOT`; then `YOU: <TEAM>`, `BACK AT <base>  ·  <N> m TO THE SLAB` (N the whole metres of the zone's distance),
##    `BACK IN <s.s>`. The team glyph is a square for Corgi Company and a triangle for Cat Cadre: shape, not colour.
## 2. A 1v1 match: the Cat bot takes the player down. The panel shows the four lines, centred: the Cat bot's name and
##    CAT CADRE with the triangle between them, YOU: CORGI COMPANY, the base and the distance from match.gd
##    respawn_zone(0) (THE FOUNDATION) and the countdown from respawn_left(). The old one-line `TAKEN DOWN  ·  back in`
##    is gone; the slab marker is hidden; the HP bar empties (its chip drains even with no hit before the takedown). A
##    takedown of a bot meanwhile does not change who took the player down. After the respawn the panel hides. A fall
##    (no killer) reads TAKEN DOWN BY THE LOT, with no glyph and no team name.
## 3. --demo's first match: the panel reads BACK AT THE SLAB'S EDGE with that spot's distance (match.gd
##    respawn_zone(team, player)), and the player then respawns there; after the rematch it reads the base again.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	errs.append_array(_pure())
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("1v1 with the human did not start")
	else:
		errs.append_array(await _panel(tree, game))
	await Kit.dispose(tree, main)
	errs.append_array(await _demo(tree))
	errs.append_array(Kit.unwatch(log))
	return errs

## --demo's first match (the match's own `demo` option, as test_game_demo.gd boots it): a downed player comes back at
## the slab's edge, so the panel must say so, with that spot's distance (respawn_zone(team, player)), and the player
## must then really respawn there. The rematch is a normal match: the base again.
func _demo(tree: SceneTree) -> Array:
	var e: Array = []
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false, "demo": true})
	var game: Node = main.get_node("Game")
	var me: Node = game.player
	if not game.playing() or me == null or game.pets.size() != 2:
		e.append("--demo: 1v1 with the human did not start")
		await Kit.dispose(tree, main)
		return e
	var cat: Node = game.pets[1]
	cat.set_physics_process(false)
	await Kit.physics(tree, 5)
	me.die(cat)
	await tree.process_frame
	await tree.process_frame
	var zone: Dictionary = game.respawn_zone(0, me)
	var want := "BACK AT %s  ·  %d m TO THE SLAB" % [game.DEMO_SPOT_NAME, roundi(float(zone.get("dist", -1.0)))]
	if zone.get("name", "") != game.DEMO_SPOT_NAME:
		e.append("--demo: respawn_zone(0, player) names %s, want %s" % [str(zone.get("name")), game.DEMO_SPOT_NAME])
	if hud_line(game, 2) != want or hud_line(game, 2).contains(game.BASE_NAMES[0]):
		e.append("--demo: the panel reads '%s', want '%s' (the player comes back beside the slab, not at the base)" % [
			hud_line(game, 2), want])
	var waited := 0
	while not me.alive and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
		await tree.physics_frame
		waited += 1
	var at: Vector3 = me.global_position
	var zp: Vector3 = zone.get("pos", Vector3.INF)
	if not me.alive or Vector2(at.x - zp.x, at.z - zp.z).length() > 1.5:
		e.append("--demo: the player came back at %s, not at the panel's spot %s" % [str(at), str(zp)])
	# the rematch is a normal match: the base again
	game.end_match(1)
	game.rematch()
	await Kit.physics(tree, 5)
	me.die(cat)
	await tree.process_frame
	await tree.process_frame
	var base: Dictionary = game.respawn_zone(0)
	var want2 := "BACK AT %s  ·  %d m TO THE SLAB" % [game.BASE_NAMES[0], roundi(float(base.get("dist", -1.0)))]
	if hud_line(game, 2) != want2:
		e.append("--demo rematch: the panel reads '%s', want '%s'" % [hud_line(game, 2), want2])
	await Kit.dispose(tree, main)
	return e

## Line `i` of the death panel now ('' when it has none).
static func hud_line(game: Node, i: int) -> String:
	var lines: PackedStringArray = game.hud.death_text
	return lines[i] if lines.size() > i else ""

func _pure() -> Array:
	var e: Array = []
	var foundation := {"name": "THE FOUNDATION", "dist": 142.24}
	var got: PackedStringArray = Hud.death_lines({"name": "Cat Bot 1", "team": 1}, 0, foundation, 2.44)
	var want := PackedStringArray(["TAKEN DOWN BY Cat Bot 1  ·  CAT CADRE", "YOU: CORGI COMPANY",
		"BACK AT THE FOUNDATION  ·  142 m TO THE SLAB", "BACK IN 2.4"])
	if got != want:
		e.append("death lines with a Cat killer: %s, want %s" % [str(got), str(want)])
	got = Hud.death_lines({}, 0, foundation, 0.96)
	want = PackedStringArray(["TAKEN DOWN BY THE LOT", "YOU: CORGI COMPANY", "BACK AT THE FOUNDATION  ·  142 m TO THE SLAB",
		"BACK IN 1.0"])
	if got != want:
		e.append("death lines with no killer: %s, want %s" % [str(got), str(want)])
	got = Hud.death_lines({"name": "Corgi Bot 1", "team": 0}, 1, {"name": "THE SCAFFOLDS", "dist": 126.5}, 3.0)
	want = PackedStringArray(["TAKEN DOWN BY Corgi Bot 1  ·  CORGI COMPANY", "YOU: CAT CADRE",
		"BACK AT THE SCAFFOLDS  ·  127 m TO THE SLAB", "BACK IN 3.0"])
	if got != want:
		e.append("death lines for a Cat taken down by a Corgi: %s, want %s" % [str(got), str(want)])
	var sq: PackedVector2Array = Hud.team_glyph(0, Vector2(50, 50), 10.0)
	var tri: PackedVector2Array = Hud.team_glyph(1, Vector2(50, 50), 10.0)
	if sq.size() != 4 or not _is_square(sq):
		e.append("the Corgi Company glyph is not a square: %s" % str(sq))
	if tri.size() != 3:
		e.append("the Cat Cadre glyph is not a triangle: %s" % str(tri))
	return e

func _panel(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var cat: Node = game.pets[1]
	cat.set_physics_process(false)
	await Kit.physics(tree, 5)
	me.die(cat)
	await tree.process_frame
	await tree.process_frame
	var zone: Dictionary = game.respawn_zone(0)
	if zone.get("name", "") != "THE FOUNDATION":
		e.append("respawn_zone(0) names %s, want THE FOUNDATION" % str(zone.get("name")))
	var left: float = game.respawn_left(me)
	var lines: PackedStringArray = hud.death_text
	var want := PackedStringArray(["TAKEN DOWN BY Cat Bot 1  ·  CAT CADRE", "YOU: CORGI COMPANY",
		"BACK AT %s  ·  %d m TO THE SLAB" % [zone.get("name", "?"), roundi(float(zone.get("dist", 0.0)))]])
	if not hud._death.visible:
		e.append("the death panel is not up while the player is down")
	if lines.size() != 4 or lines.slice(0, 3) != want:
		e.append("death panel %s, want %s + BACK IN <s.s>" % [str(lines), str(want)])
	else:
		var back := lines[3]
		if not back.begins_with("BACK IN ") or back.length() != "BACK IN 0.0".length() \
				or absf(float(back.substr(8)) - left) > 0.15:
			e.append("countdown line %s, respawn_left() %.2f" % [back, left])
		# the labels on screen say the same, line 1 split around the glyph
		if hud._death_by.text + "  " + hud._death_team.text != lines[0]:
			e.append("line 1 on screen reads '%s' + glyph + '%s', want %s" % [hud._death_by.text, hud._death_team.text, lines[0]])
		if hud._death_you.text != lines[1] or hud._death_base.text != lines[2] or hud._death_in.text != lines[3]:
			e.append("lines 2-4 on screen: %s / %s / %s" % [hud._death_you.text, hud._death_base.text, hud._death_in.text])
	if hud._center.text.findn("back in") >= 0 and hud._center.text.begins_with("TAKEN DOWN"):
		e.append("the old one-line death text still shows: %s" % hud._center.text)
	# the glyph: Cat Cadre's triangle, between the killer's name and the team name, on the same row
	var g: Control = hud._death_glyph
	var by: Rect2 = hud._death_by.get_global_rect()
	var team: Rect2 = hud._death_team.get_global_rect()
	var gr: Rect2 = g.get_global_rect()
	if not g.is_visible_in_tree() or g.team != 1 or not hud._death_team.is_visible_in_tree():
		e.append("the killer's team glyph or team name is not shown (glyph team %d)" % g.team)
	if gr.position.x < by.end.x - 0.5 or gr.end.x > team.position.x + 0.5 or absf(gr.get_center().y - by.get_center().y) > 6.0:
		e.append("the glyph %s is not between '%s' %s and '%s' %s" % [str(gr), hud._death_by.text, str(by), hud._death_team.text, str(team)])
	# centred: the panel's middle on the screen's middle
	var panel: Rect2 = hud._death.get_global_rect()
	var row_mid := (by.position.x + team.end.x) * 0.5
	if absf(panel.get_center().x - 640.0) > 1.0 or absf(row_mid - 640.0) > 2.0 or absf(panel.get_center().y - 360.0) > 40.0:
		e.append("the death panel %s (line 1 centred at x %.1f) is not in the centre of the screen" % [str(panel), row_mid])
	# a takedown without a hit (die(): no damaged signal) still drains the HP bar: no white bar while down
	await tree.create_timer(Hud.CHIP_DRAIN + 0.1).timeout
	await tree.process_frame
	await tree.process_frame
	if hud._chip.is_visible_in_tree() and hud._chip.size.x > 0.5:
		e.append("%.1f s after the takedown the HP bar still shows a %.0f px chip" % [Hud.CHIP_DRAIN + 0.1, hud._chip.size.x])
	if hud.marker.get("visible", false):
		e.append("the slab marker shows while the player is down")
	# a takedown of the bot does not overwrite who took the player down
	cat.die(null)
	await tree.process_frame
	await tree.process_frame
	if hud.down_by.get("name", "") != "Cat Bot 1" or not hud.death_text[0].begins_with("TAKEN DOWN BY Cat Bot 1"):
		e.append("a bot's takedown changed the player's killer to %s" % str(hud.down_by))
	# back up: the panel hides
	var waited := 0
	while not me.alive and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
		await tree.physics_frame
		waited += 1
	await tree.process_frame
	await tree.process_frame
	if not me.alive:
		e.append("the player did not respawn")
	elif hud._death.visible or not hud.death_text.is_empty():
		e.append("the death panel stays up after the respawn: %s" % str(hud.death_text))
	# a fall: no killer
	me.die(null)
	await tree.process_frame
	await tree.process_frame
	if hud.death_text.is_empty() or hud.death_text[0] != "TAKEN DOWN BY THE LOT" or hud._death_by.text != "TAKEN DOWN BY THE LOT":
		e.append("a fall reads %s / %s, want TAKEN DOWN BY THE LOT" % [str(hud.death_text), hud._death_by.text])
	if hud._death_glyph.is_visible_in_tree() or hud._death_team.is_visible_in_tree():
		e.append("a fall still shows a team glyph or team name")
	return e

static func _is_square(p: PackedVector2Array) -> bool:
	var s := p[0].distance_to(p[1])
	for i in 4:
		var a := p[i]
		var b := p[(i + 1) % 4]
		var c := p[(i + 2) % 4]
		if absf(a.distance_to(b) - s) > 0.01 or absf((b - a).dot(c - b)) > 0.01:
			return false
	return s > 0.0

extends RefCounted
## W15 G-HUD Sprint C: the contract's clauses, one check each (docs/qa/w15/HUD_CONTRACT.md §2-§4). The HUD's own
## _process is switched off and the test steps it with exact deltas, so the timings are measured, not raced.
## - §3 timing: a body confirm shows 0.18 s, a kill 0.35 s; a body hit 0.1 s into a kill does not cut the kill short;
##   a wedge lasts WEDGE_FADE (0.6 s); the HP chip drains linearly over CHIP_DRAIN (0.4 s): half left at 0.2 s, a
##   quarter at 0.3 s, none at 0.41 s.
## - §2 backing: the death panel's backing is black at alpha 0.55, rounded, behind the four lines.
## - §3 numbers as literals: the flash cap 0.25, the marker's dimmed alpha 0.35, the wedge ring about 110 px.
## - §4 fields, every string: the timer m:ss, white above 30 s and red from 30 s down; OVERTIME in amber; the slab line
##   `SLAB  NEUTRAL`, `SLAB  CORGI COMPANY HOLDING  +1/s`, `SLAB  CAT CADRE HOLDING  +1/s` and `SLAB  CONTESTED`;
##   ammo `<n> / 30` and `RELOADING`; the win title `CORGI COMPANY WINS`, `CAT CADRE WINS` and `DRAW`; the full win sub
##   (`<a>  –  <b>`, `You: <k> takedowns · <d> knockouts`, a blank line, the rematch line); the hint naming R and X for
##   reload.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")

const REMATCH_LINE := "R / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2"

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("1v1 with the human did not start")
	else:
		var hud: Node = game.hud
		for p in game.pets:
			p.set_physics_process(false)  # nobody moves, falls or reloads on their own
		game.set_physics_process(false)  # the match clock and the slab state stay where the test sets them
		hud.set_process(false)  # the test steps the HUD
		hud._process(0.0)
		errs.append_array(_numbers())
		errs.append_array(_timing(game))
		errs.append_array(await _backing(tree, game))
		errs.append_array(_fields(game))
		game.set_physics_process(true)
		hud.set_process(true)
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## §3 numbers the other HUD tests read through hud.gd's symbols, as the contract's literals.
static func _numbers() -> Array:
	var e: Array = []
	if Hud.FLASH_MAX != 0.25:
		e.append("the red flash is capped at alpha %.2f, the contract says 0.25" % Hud.FLASH_MAX)
	if Hud.MARKER_DIM != 0.35:
		e.append("a wedge over the marker dims it to alpha %.2f, the contract says 0.35" % Hud.MARKER_DIM)
	if absf(Hud.HIT_RING - 110.0) > 10.0:
		e.append("the wedge ring is %.0f px, the contract says about 110" % Hud.HIT_RING)
	return e

static func confirm(game: Node, kill: bool) -> void:
	var cat: Node = game.pets[1]
	game.player.hit_confirmed.emit({"kill": kill, "head": false, "hit": true, "target": cat, "pos": cat.global_position, "damage": 15.0})

func _timing(game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var cat: Node = game.pets[1]
	# body 0.18 s
	confirm(game, false)
	hud._process(0.17)
	var body_left: float = hud.hit_t
	hud._process(0.02)
	if body_left <= 0.0 or hud.hit_t > 0.0:
		e.append("a body confirm: %.3f s left at 0.17 s, %.3f s at 0.19 s (want shown 0.18 s)" % [body_left, hud.hit_t])
	# kill 0.35 s
	confirm(game, true)
	hud._process(0.3)
	var kill_left: float = hud.hit_t
	var kind: String = hud.hit_kind
	hud._process(0.06)
	if kind != "kill" or kill_left <= 0.0 or hud.hit_t > 0.0:
		e.append("a kill confirm: %s with %.3f s left at 0.30 s, %.3f s at 0.36 s (want the kill shown 0.35 s)" % [kind,
			kill_left, hud.hit_t])
	# a body hit 0.1 s into a kill does not cut it short; after the kill, a body hit shows again
	confirm(game, true)
	hud._process(0.1)
	confirm(game, false)
	if hud.hit_kind != "kill" or absf(hud.hit_t - (Hud.KILL_SHOW - 0.1)) > 0.001:
		e.append("a body hit 0.1 s into a kill: %s with %.3f s left (want the kill, %.2f s left)" % [hud.hit_kind, hud.hit_t,
			Hud.KILL_SHOW - 0.1])
	hud._process(0.26)
	confirm(game, false)
	if hud.hit_kind != "body" or absf(hud.hit_t - Hud.HIT_SHOW) > 0.001:
		e.append("a body hit after the kill ended: %s with %.3f s (want body, %.2f s)" % [hud.hit_kind, hud.hit_t, Hud.HIT_SHOW])
	hud._process(1.0)
	# a wedge lasts 0.6 s; the chip drains linearly over 0.4 s
	cat.global_position = me.global_position + Vector3(7, 0, 0)
	me.shield = 0.0
	hud._process(0.0)
	me.take_damage(30.0, cat)  # 60 px of the 240 px bar
	hud._process(0.0)
	var full: float = hud._chip.size.x
	var widths := []
	for d in [0.2, 0.1, 0.11]:
		hud._process(d)
		widths.append(hud._chip.size.x if hud._chip.visible else 0.0)
	var want_full := Hud.HP_W * 30.0 / float(T.MAX_HP)
	if absf(full - want_full) > 0.5 or absf(widths[0] - want_full * 0.5) > 0.5 or absf(widths[1] - want_full * 0.25) > 0.5 or widths[2] > 0.01:
		e.append("the chip after a 30 HP hit: %.1f px, then %.1f at 0.2 s, %.1f at 0.3 s, %.1f at 0.41 s (want %.0f, %.0f, %.0f, 0: linear over 0.4 s)" % [
			full, widths[0], widths[1], widths[2], want_full, want_full * 0.5, want_full * 0.25])
	var wedge_at := []
	hud._process(0.13)  # 0.54 s after the hit
	wedge_at.append(hud.wedges.size())
	hud._process(0.07)  # 0.61 s
	wedge_at.append(hud.wedges.size())
	if wedge_at != [1, 0]:
		e.append("the wedge: %d at 0.54 s, %d at 0.61 s after the hit (want 1, then 0: it lasts 0.6 s)" % [wedge_at[0], wedge_at[1]])
	me.hp = T.MAX_HP
	hud._process(1.0)
	return e

func _backing(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	me.die(game.pets[1])
	hud._process(0.0)
	await tree.process_frame  # the panel's layout settles
	await tree.process_frame
	var panel: PanelContainer = hud._death
	var sb := panel.get_theme_stylebox("panel")
	if not panel.visible:
		e.append("the death panel is not up while the player is down")
	if not (sb is StyleBoxFlat):
		e.append("the death panel has no flat backing (%s)" % str(sb))
	else:
		var f := sb as StyleBoxFlat
		var bg := f.bg_color
		if absf(bg.a - 0.55) > 0.01 or maxf(bg.r, maxf(bg.g, bg.b)) > 0.05 or not f.draw_center or f.corner_radius_top_left < 2:
			e.append("the death panel's backing is %s (alpha %.2f, corner %d), want black at alpha 0.55, rounded" % [bg.to_html(),
				bg.a, f.corner_radius_top_left])
	var box: Rect2 = panel.get_global_rect()
	for l in [hud._death_by, hud._death_you, hud._death_base, hud._death_in]:
		if not box.encloses((l as Control).get_global_rect()):
			e.append("the death panel's backing %s does not hold '%s'" % [str(box), (l as Label).text])
	me.respawn(me.global_position, me.yaw)
	hud._process(0.0)
	return e

func _fields(game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	# the timer: m:ss, white above 30 s, red from 30 s down; OVERTIME in amber
	for row in [[95.2, "1:36", false], [30.4, "0:31", false], [30.0, "0:30", true], [7.0, "0:07", true]]:
		game.time_left = row[0]
		hud._process(0.0)
		var col: Color = hud._timer.label_settings.font_color
		var red := col.r > 0.9 and col.g < 0.6 and col.b < 0.6
		var white := col.r > 0.95 and col.g > 0.95 and col.b > 0.95
		if hud._timer.text != row[1] or (red if row[2] else white) == false:
			e.append("time left %.1f s: the timer reads %s in %s, want %s in %s" % [row[0], hud._timer.text, col.to_html(false), row[1],
				"red" if row[2] else "white"])
	game.overtime = true
	hud._process(0.0)
	var oc: Color = hud._timer.label_settings.font_color
	if hud._timer.text != "OVERTIME" or not (oc.r > 0.9 and oc.g > 0.45 and oc.g < 0.75 and oc.b < 0.35):
		e.append("overtime: the timer reads %s in %s, want OVERTIME in amber" % [hud._timer.text, oc.to_html(false)])
	game.overtime = false
	game.time_left = T.MATCH_TIME
	# the slab line, every state
	for row in [[{"holder": -1, "contested": false, "counts": [0, 0]}, "SLAB  NEUTRAL"],
			[{"holder": 0, "contested": false, "counts": [1, 0]}, "SLAB  CORGI COMPANY HOLDING  +1/s"],
			[{"holder": 1, "contested": false, "counts": [0, 1]}, "SLAB  CAT CADRE HOLDING  +1/s"],
			[{"holder": -1, "contested": true, "counts": [1, 1]}, "SLAB  CONTESTED"]]:
		game.slab_state = row[0]
		hud._process(0.0)
		if hud._slab.text != row[1]:
			e.append("slab state %s: the slab line reads '%s', want '%s'" % [str(row[0]), hud._slab.text, row[1]])
	game.slab_state = {"holder": -1, "contested": false, "counts": [0, 0]}
	# ammo and RELOADING
	me.rifle.ammo = 12
	hud._process(0.0)
	var ammo: String = hud._ammo.text
	me.rifle.start_reload()
	hud._process(0.0)
	if ammo != "12 / 30" or hud._ammo.text != "RELOADING":
		e.append("ammo reads '%s', then '%s' while reloading (want '12 / 30', then 'RELOADING')" % [ammo, hud._ammo.text])
	me.rifle.refill()
	# the hint names R and X for reload
	if not hud._hint.text.contains("R / X reload"):
		e.append("the hint does not name X with R for reload: %s" % hud._hint.text.c_escape())
	# win titles and the full win sub
	me.kills = 3
	me.deaths = 2
	for row in [[0, [60, 41], "CORGI COMPANY WINS"], [1, [52, 60], "CAT CADRE WINS"], [-1, [17, 17], "DRAW"]]:
		game.score = row[1]
		game.end_match(row[0])
		hud._process(0.0)
		var sub := "%d  –  %d\nYou: 3 takedowns · 2 knockouts\n\n%s" % [row[1][0], row[1][1], REMATCH_LINE]
		if hud._win_title.text != row[2] or hud._win_sub.text != sub:
			e.append("winner %d: the win screen reads '%s' / '%s', want '%s' / '%s'" % [row[0], hud._win_title.text,
				hud._win_sub.text.c_escape(), row[2], sub.c_escape()])
		var tc: Color = hud._win_title.label_settings.font_color
		var want: Color = Color.WHITE if row[0] < 0 else T.TEAM_COLORS[row[0]].lightened(0.4)
		if not tc.is_equal_approx(want):
			e.append("winner %d: the title is %s, want %s" % [row[0], tc.to_html(false), want.to_html(false)])
		if hud._slab.visible:
			e.append("winner %d: the slab line still shows" % row[0])
		game.rematch()
		hud._process(0.0)
	return e

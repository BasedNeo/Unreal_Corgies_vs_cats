extends RefCounted
## W15 G-HUD Sprint C: what the overlay actually draws. draw_overlay only iterates overlay_prims() (hud.gd), the items
## build_overlay(state) returns, so these checks are on the drawn items, not only on the geometry functions.
## 1. Pure, build_overlay:
##    - the marker for each state draws its two lines, then its shape: the state's own shape (CONTESTED split, held
##      filled, NEUTRAL hollow) in the state's colour, with both lines' bottoms above the shape's top tip;
##    - while alive and playing: the crosshair, the confirm on show (body white X, head yellow X with a diamond, kill
##      red X with a ring) and each wedge (an arrowhead about HIT_RING px out along its direction, fading with life);
##    - a wedge whose box overlaps the marker's box dims every marker item to MARKER_DIM alpha; one that does not
##      leaves it at full alpha;
##    - over (the win screen) or down: no crosshair, no confirm and no wedge, whatever the cue timers hold.
## 2. glyph_prims: Corgi Company a square, Cat Cadre a triangle, each in its team colour lightened (hue kept).
## 3. Live, 1v1: the overlay draws the marker and the crosshair; after a kill confirm the kill cue; after a hit from
##    the Cat bot a wedge; once the match is won none of the crosshair, the cues or the marker, though the timers run.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")
const Marker := preload("res://tests/test_hud_marker.gd")

const SIZE := Vector2(1280, 720)

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	errs.append_array(_marker_items())
	errs.append_array(_cue_items())
	errs.append_array(_dim_and_over())
	errs.append_array(_glyphs())
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("1v1 with the human did not start")
	else:
		errs.append_array(await _live(tree, game))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## A visible marker dict as marker_frame builds one, for slab state `st`, its shape at `pos`.
static func marker_at(st: Dictionary, pos: Vector2) -> Dictionary:
	var font := ThemeDB.fallback_font
	var lines: PackedStringArray = Hud.marker_lines(st, 42)
	var off: Rect2 = Hud.marker_box(font.get_string_size(lines[0], HORIZONTAL_ALIGNMENT_LEFT, -1, Hud.MARKER_PX[0]),
		font.get_string_size(lines[1], HORIZONTAL_ALIGNMENT_LEFT, -1, Hud.MARKER_PX[1]))
	return {"visible": true, "spec": Hud.marker_spec(st), "lines": lines, "pos": pos, "rect": Rect2(pos + off.position, off.size)}

static func state(marker: Dictionary, extra := {}) -> Dictionary:
	var st := {"size": SIZE, "font": ThemeDB.fallback_font, "marker": marker, "over": false, "alive": true, "spread": 0.02,
		"hit_kind": "body", "hit_t": 0.0, "wedges": []}
	st.merge(extra, true)
	return st

static func items(list: Array, what: String) -> Array:
	return list.filter(func(it): return it.what == what)

func _marker_items() -> Array:
	var e: Array = []
	for row in Marker.STATES:
		var st: Dictionary = row[0]
		var mk := marker_at(st, Vector2(640, 250))
		var out: Array = Hud.build_overlay(state(mk))
		var texts := items(out, "marker_text")
		var shapes := items(out, "marker_shape")
		if texts.size() != 2 or shapes.size() != 1:
			e.append("%s: the overlay draws %d marker lines and %d shapes, want 2 and 1" % [row[1], texts.size(), shapes.size()])
			continue
		var sh: Dictionary = shapes[0]
		var want: Dictionary = Hud.marker_shapes(row[2], mk.pos)
		if sh.shape != row[2] or Marker.signature(sh.prims) != Marker.signature(want):
			e.append("%s is drawn as %s (%s), want %s (%s)" % [row[1], sh.shape, Marker.signature(sh.prims), row[2], Marker.signature(want)])
		if not (sh.color as Color).is_equal_approx(Hud.marker_spec(st).color):
			e.append("%s's shape is drawn in %s, want %s" % [row[1], (sh.color as Color).to_html(), Hud.marker_spec(st).color.to_html()])
		var tip: float = mk.pos.y - Hud.MARKER_R
		for t in texts:
			if t.text != mk.lines[t.line]:
				e.append("%s: marker line %d drawn as '%s', want '%s'" % [row[1], t.line, t.text, mk.lines[t.line]])
			if float(t.bottom) > tip + 0.01 or (t.pos as Vector2).y > tip:
				e.append("%s: marker line '%s' is drawn at y %.1f-%.1f, not above the shape's top tip %.1f" % [row[1], t.text,
					t.top, t.bottom, tip])
		if texts[0].bottom > texts[1].top + 0.01:
			e.append("%s: the distance line is not above the state word" % row[1])
		if not (texts[1].color as Color).is_equal_approx(Hud.marker_spec(st).color):
			e.append("%s: the state word is not drawn in the state's colour" % row[1])
	return e

func _cue_items() -> Array:
	var e: Array = []
	var mk := {"visible": false}
	var c := SIZE * 0.5
	var want_col := {"body": [0.9, 0.9, 0.9], "head": [0.9, 0.75, -1.0], "kill": [0.9, -1.0, -1.0]}
	for kind in ["body", "head", "kill"]:
		var out: Array = Hud.build_overlay(state(mk, {"hit_kind": kind, "hit_t": 0.1}))
		var cf := items(out, "confirm")
		if items(out, "crosshair").size() != 1:
			e.append("%s: no crosshair drawn while alive and playing" % kind)
		if cf.size() != 1:
			e.append("%s: %d confirm cues drawn, want 1" % [kind, cf.size()])
			continue
		if cf[0].kind != kind or Marker.signature(cf[0].prims) != Marker.signature(Hud.hit_cue(kind, c)):
			e.append("%s confirm drawn as %s (%s)" % [kind, cf[0].kind, Marker.signature(cf[0].prims)])
		var col: Color = cf[0].color
		var ok := col.r > 0.9 and col.a > 0.0
		match kind:
			"body":
				ok = ok and col.g > 0.9 and col.b > 0.9
			"head":
				ok = ok and col.g > 0.75 and col.b < 0.4
			"kill":
				ok = ok and col.g < 0.4 and col.b < 0.4
		if not ok:
			e.append("%s confirm drawn in %s, want %s" % [kind, col.to_html(), ["white", "yellow", "red"][["body", "head", "kill"].find(kind)]])
	# none on show: no confirm drawn
	if not items(Hud.build_overlay(state(mk, {"hit_t": 0.0})), "confirm").is_empty():
		e.append("a confirm is drawn with no hit on show")
	# a wedge per entry, out along its direction, fading with its life
	var out2: Array = Hud.build_overlay(state(mk, {"wedges": [{"dir": Vector2(1, 0), "t": Hud.WEDGE_FADE},
		{"dir": Vector2(0, 1), "t": Hud.WEDGE_FADE * 0.5}]}))
	var ws := items(out2, "wedge")
	if ws.size() != 2:
		e.append("%d wedges drawn for 2 received hits" % ws.size())
	else:
		for i in 2:
			var tri: PackedVector2Array = ws[i].prims.fills[0]
			var mid := (tri[0] + tri[1] + tri[2]) / 3.0
			var d: Vector2 = [Vector2(1, 0), Vector2(0, 1)][i]
			if (mid - c).normalized().dot(d) < 0.99 or absf(mid.distance_to(c) - Hud.HIT_RING) > 15.0:
				e.append("wedge %d drawn at %s, want about %.0f px out along %s" % [i, str(mid), Hud.HIT_RING, str(d)])
		if absf((ws[0].color as Color).a - 1.0) > 0.01 or absf((ws[1].color as Color).a - 0.5) > 0.01:
			e.append("wedge alphas %.2f / %.2f, want 1.0 / 0.5 (fading over WEDGE_FADE)" % [ws[0].color.a, ws[1].color.a])
	return e

func _dim_and_over() -> Array:
	var e: Array = []
	var c := SIZE * 0.5
	var st := {"holder": 1, "contested": false, "counts": [0, 1]}
	# a wedge pointing right sits about 110 px right of the crosshair: a marker there is dimmed, one elsewhere is not
	var over_it := marker_at(st, c + Vector2(Hud.HIT_RING, 30.0))
	var elsewhere := marker_at(st, c + Vector2(-300.0, -150.0))
	var wedge := [{"dir": Vector2(1, 0), "t": Hud.WEDGE_FADE}]
	var dimmed: Array = Hud.build_overlay(state(over_it, {"wedges": wedge}))
	var wr: Rect2 = items(dimmed, "wedge")[0].rect
	if not (over_it.rect as Rect2).intersects(wr):
		e.append("test setup: the marker %s does not overlap the wedge %s" % [str(over_it.rect), str(wr)])
	for it in items(dimmed, "marker_text") + items(dimmed, "marker_shape"):
		var want := (0.92 if it.what == "marker_text" and it.line == 0 else 1.0) * Hud.MARKER_DIM
		if absf((it.color as Color).a - want) > 0.01:
			e.append("a wedge over the marker: marker %s drawn at alpha %.2f, want %.2f" % [it.what, it.color.a, want])
	for it in items(Hud.build_overlay(state(elsewhere, {"wedges": wedge})), "marker_shape"):
		if absf((it.color as Color).a - 1.0) > 0.01:
			e.append("a wedge away from the marker still dims it (alpha %.2f)" % it.color.a)
	# over (the win screen) and down: no crosshair, no confirm, no wedge, whatever the timers hold
	for row in [["over", {"over": true}], ["down", {"alive": false}]]:
		var extra: Dictionary = row[1].duplicate()
		extra.merge({"hit_kind": "kill", "hit_t": Hud.KILL_SHOW, "wedges": wedge})
		var out: Array = Hud.build_overlay(state({"visible": false}, extra))
		for what in ["crosshair", "confirm", "wedge"]:
			if not items(out, what).is_empty():
				e.append("%s: the overlay still draws a %s" % [row[0], what])
	return e

func _glyphs() -> Array:
	var e: Array = []
	for team in 2:
		var g: Dictionary = Hud.glyph_prims(team, Vector2(22, 22))
		var n: int = g.prims.fills[0].size()
		if n != [4, 3][team]:
			e.append("team %d's glyph has %d corners, want %d" % [team, n, [4, 3][team]])
		var col: Color = g.color
		var tc: Color = T.TEAM_COLORS[team]
		if absf(col.h - tc.h) > 0.02 or col.get_luminance() <= tc.get_luminance() + 0.05 or col.s < 0.3:
			e.append("team %d's glyph is drawn in %s, want its team colour %s lightened" % [team, col.to_html(false), tc.to_html(false)])
	return e

func _live(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var cat: Node = game.pets[1]
	cat.set_physics_process(false)
	await Kit.physics(tree, 5)
	await tree.process_frame
	await tree.process_frame
	var out: Array = hud.overlay_prims()
	if items(out, "marker_text").size() != 2 or items(out, "marker_shape").size() != 1 or items(out, "crosshair").size() != 1:
		e.append("live: the overlay does not draw the marker (2 lines + shape) and the crosshair: %s" % str(out.map(func(it): return it.what)))
	me.hit_confirmed.emit({"kill": true, "head": false, "hit": true, "target": cat, "pos": cat.global_position, "damage": 15.0})
	cat.global_position = me.global_position + Vector3(6, 0, 0)
	me.shield = 0.0
	me.take_damage(10.0, cat)
	await tree.process_frame
	await tree.process_frame
	out = hud.overlay_prims()
	var cf := items(out, "confirm")
	if cf.size() != 1 or cf[0].kind != "kill":
		e.append("live: after a kill confirm the overlay draws %s" % str(cf.map(func(it): return it.kind)))
	if items(out, "wedge").size() != 1:
		e.append("live: after a hit from the Cat bot the overlay draws %d wedges" % items(out, "wedge").size())
	game.end_match(0)
	me.hit_confirmed.emit({"kill": false, "head": false, "hit": true, "target": cat, "pos": cat.global_position, "damage": 15.0})
	await tree.process_frame
	await tree.process_frame
	out = hud.overlay_prims()
	if not out.is_empty():
		e.append("live, over the win screen the overlay still draws %s" % str(out.map(func(it): return it.what)))
	game.rematch()
	return e

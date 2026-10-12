extends RefCounted
## W17 TW-VIEW H1 + H20 (docs/qa/w17/PARITY.md rows H1 and H20, DEFECT G10 and G21): pins what hud.gd draws for the
## crosshair's gap and the confirm X's size, from the items draw_overlay iterates (build_overlay / overlay_prims), so the
## web twin (src/client/ui/crosshair.ts, slab-hud.ts slabHitArms) has a fixed target. hud.gd is read, never changed.
## 1. Pure, build_overlay: the "crosshair" item sits at the canvas centre with gap = 5 + spread × 420 (720p canvas
##    units) for any spread; the rifle's own spreads give 13.8 (hip), 7.6 (aim), 18.2 (hip at the run speed), 24.4
##    (hip in the air). And the LINES drawn from that item: hud.gd's own _draw_item, compiled from its source into a
##    recorder (drawn()), draws each arm (a dark 4 px line under a 2 px one) from c + d × gap to c + d × (gap + 9) for
##    d right, left, up, down, plus the 1.6 px dot, so a change in the draw path (gap × 0.5, say) shows here too.
## 2. Pure, the "confirm" item's X (hit_cue): four lines, one per unnormalised (±1, ±1) diagonal, from d × r0 to d × r1,
##    so the arms reach 7.07-14.1 px from the centre for body and head and 8.5-21.2 px for a kill.
## 3. Pure, the X's PAINT (W17 H20, lead ruling 2026-10-12: the drawing rule is pinned in both builds): hud.gd's own
##    _draw_item and draw_prims, compiled from its source into the recorder (drawn() and paint_errors()), draw a confirm in this order
##    and no other: [head: the diamond's dark rim, a closed polyline 4 px wide]; the four lines dark, Color(0, 0, 0,
##    0.8 × a), w + 2 wide; the four lines in the cue's colour (alpha a), w wide, all through draw_line (no caps);
##    [head: the diamond filled in colour]; [kill: the ring dark, w + 2, then in colour, w, after both line loops].
##    w = pr.width: 2.5 body and head, 3.0 kill; the colours CUE written out below; a at full show and half faded.
##    The web twin (slab-hud.ts slabHitSvg, tests/unit/slab-hud.test.ts) pins the same order and strokes.
## 4. Live, 1v0 as test_game_move: the gap follows the player's own spread (hud.gd overlay_state: current_spread() +
##    rifle.bloom): 13.8 at rest, 7.6 aiming, 18.2 running, 24.4 standing in the air, back to 13.8 on landing; one
##    shot's bloom adds 0.16° × 420; the arms hud.gd draws from the live item start at that gap (rest, running, in
##    the air); and a body, head and kill confirm draw Godot's X, painted as in 3.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")

const SIZE := Vector2(1280, 720)
## Godot's rifle written out (tuning.gd:29-30): a change there, or to hud.gd's rule, shows here.
const HIP := 1.2 * PI / 180.0
const AIM := 0.35 * PI / 180.0
const MOVE_MULT := 1.5
const AIR_MULT := 2.2
const BLOOM := 0.16 * PI / 180.0
## The gaps those spreads give (720p px): 5 + spread × 420.
const GAP_REST := 13.796
const GAP_AIM := 7.566
const GAP_RUN := 18.195
const GAP_AIR := 24.352
const GAP_SHOT := 14.969
## X arm reach (px from the centre): r0·√2 to r1·√2.
const REACH := {"body": [7.071, 14.142], "head": [7.071, 14.142], "kill": [8.485, 21.213]}
const R := {"body": [5.0, 10.0], "head": [5.0, 10.0], "kill": [6.0, 15.0]}
const DIAG := [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]
## The X's paint (hud.gd hit_cue + draw_prims), written out: the line width w (pr.width), the underlay's extra width and
## alpha factor, the cue colours (hud.gd CUE_COLORS; the web's 0xffffff, 0xffd933, 0xff4033), the kill ring's radius,
## the head diamond's half-size and its dark rim's width.
const W := {"body": 2.5, "head": 2.5, "kill": 3.0}
const UNDER := 2.0
const DARK_A := 0.8
const CUE := {"body": Color(1, 1, 1), "head": Color(1.0, 0.85, 0.2), "kill": Color(1.0, 0.25, 0.2)}
const RING := 9.0
const DIAMOND := 4.5
const DIAMOND_RIM := 4.0
## The crosshair's arms as hud.gd _draw_item draws them: in this order, each 9 px long, dark 4 px under light 2 px.
const ARMS := [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]
const ARM_LEN := 9.0
## The recorder hud.gd's _draw_item and draw_prims are compiled into (drawn(), paint_errors()): a hud.gd (a CanvasLayer, so
## no CanvasItem method is overridden) that keeps every draw call it is given instead of drawing: draw_line and
## draw_circle in rec_lines / rec_circles, and every call, in order, in rec_ops.
const REC_SRC := """extends "res://game/hud.gd"
var rec_lines: Array = []
var rec_circles: Array = []
var rec_ops: Array = []
func draw_line(a: Vector2, b: Vector2, col: Color, w := -1.0, aa := false) -> void:
	rec_lines.append({"from": a, "to": b, "color": col, "width": w})
	rec_ops.append({"op": "line", "from": a, "to": b, "color": col, "width": w, "aa": aa})
func draw_circle(c: Vector2, r: float, col: Color, filled := true, w := -1.0, aa := false) -> void:
	rec_circles.append({"center": c, "radius": r, "color": col})
	rec_ops.append({"op": "circle", "center": c, "radius": r, "color": col, "filled": filled, "width": w, "aa": aa})
func draw_polyline(pts: PackedVector2Array, col: Color, w := -1.0, aa := false) -> void:
	rec_ops.append({"op": "polyline", "points": pts, "color": col, "width": w, "aa": aa})
func draw_colored_polygon(pts: PackedVector2Array, col: Color, _uvs := PackedVector2Array(), _tex: Texture2D = null) -> void:
	rec_ops.append({"op": "polygon", "points": pts, "color": col})
func draw_arc(c: Vector2, r: float, a0: float, a1: float, n: int, col: Color, w := -1.0, aa := false) -> void:
	rec_ops.append({"op": "arc", "center": c, "radius": r, "from": a0, "to": a1, "points": n, "color": col, "width": w, "aa": aa})
"""
const DRAW_ITEM_SIG := "func _draw_item(ci: CanvasItem, it: Dictionary) -> void:"
const DRAW_PRIMS_SIG := "static func draw_prims(ci: CanvasItem, pr: Dictionary, col: Color) -> void:"
## _draw_item's call into draw_prims (its default branch: the marker shape, the confirm, the wedges), pointed at the
## recorder's compiled copy.
const DRAW_PRIMS_CALL := "draw_prims(ci, "

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	errs.append_array(_gap_rule())
	errs.append_array(_x_reach())
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 0})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null:
		errs.append("the match did not start with a player")
	else:
		errs.append_array(await _live(tree, game))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

static func state(extra := {}) -> Dictionary:
	var st := {"size": SIZE, "font": ThemeDB.fallback_font, "marker": {"visible": false}, "over": false, "alive": true,
		"spread": 0.0, "hit_kind": "body", "hit_t": 0.0, "wedges": []}
	st.merge(extra, true)
	return st

static func items(list: Array, what: String) -> Array:
	return list.filter(func(it): return it.what == what)

## The crosshair item's gap in `out`, or -1 if none is drawn.
static func gap_of(out: Array) -> float:
	var xs := items(out, "crosshair")
	return float(xs[0].gap) if xs.size() == 1 else -1.0

## The X of a confirm item against hud.gd's rule; `c` the centre.
static func x_errors(label: String, kind: String, pr: Dictionary, c: Vector2) -> Array:
	var e: Array = []
	var lines: Array = pr.lines
	if lines.size() != 4:
		return ["%s %s: the X has %d lines, want 4" % [label, kind, lines.size()]]
	var r0: float = R[kind][0]
	var r1: float = R[kind][1]
	for i in 4:
		var a: Vector2 = lines[i][0] - c
		var b: Vector2 = lines[i][1] - c
		var d: Vector2 = DIAG[i]
		if not a.is_equal_approx(d * r0) or not b.is_equal_approx(d * r1):
			e.append("%s %s: arm %d runs %s-%s from the centre, want %s-%s (the (±1, ±1) diagonal)" % [label, kind, i, a, b,
				d * r0, d * r1])
		if absf(a.length() - REACH[kind][0]) > 0.01 or absf(b.length() - REACH[kind][1]) > 0.01:
			e.append("%s %s: arm %d reaches %.2f-%.2f px, want %.2f-%.2f" % [label, kind, i, a.length(), b.length(),
				REACH[kind][0], REACH[kind][1]])
	return e

## hud.gd's function `sig` as its source has it, its first line replaced by `header` (so `ci` is untyped and the recorder
## stands in for the canvas); "" if hud.gd has no such function.
static func func_source(sig: String, header: String) -> String:
	var out := PackedStringArray()
	var on := false
	for l in FileAccess.get_file_as_string("res://game/hud.gd").split("\n"):
		if l == sig:
			on = true
			out.append(header)
		elif on:
			if l != "" and not l.begins_with("\t"):
				break
			out.append(l)
	return "\n".join(out) if on else ""

## hud.gd's _draw_item, renamed _draw_item_rec, with its draw_prims call sent to draw_prims_rec: hud.gd's draw_prims,
## also from its source (a recorder method with `ci` untyped). {error} if either cannot be read.
static func recorder_source() -> Dictionary:
	var item := func_source(DRAW_ITEM_SIG, "func _draw_item_rec(ci, it: Dictionary) -> void:")
	if item == "":
		return {"error": "hud.gd has no `%s` to read" % DRAW_ITEM_SIG}
	var prims := func_source(DRAW_PRIMS_SIG, "func draw_prims_rec(ci, pr: Dictionary, col: Color) -> void:")
	if prims == "":
		return {"error": "hud.gd has no `%s` to read" % DRAW_PRIMS_SIG}
	if item.count(DRAW_PRIMS_CALL) != 1:
		return {"error": "hud.gd's _draw_item calls `%s` %d times, want once (its default branch)" % [DRAW_PRIMS_CALL,
			item.count(DRAW_PRIMS_CALL)]}
	return {"source": REC_SRC + item.replace(DRAW_PRIMS_CALL, "draw_prims_rec(ci, ") + "\n\n" + prims + "\n"}

## Everything hud.gd's own _draw_item (and the draw_prims it calls) draws for the overlay item `it`: {lines: [{from, to,
## color, width}], circles: [...], ops: [every call, in drawing order]}; {error} if it cannot be read.
static func drawn(it: Dictionary) -> Dictionary:
	var src := recorder_source()
	if src.has("error"):
		return src
	var gd := GDScript.new()
	gd.source_code = src.source
	if gd.reload() != OK:
		return {"error": "hud.gd's _draw_item and draw_prims do not compile into the recorder"}
	var rec: Node = gd.new()
	rec.call("_draw_item_rec", rec, it)
	var out := {"lines": rec.get("rec_lines"), "circles": rec.get("rec_circles"), "ops": rec.get("rec_ops")}
	rec.free()
	return out

## The paint hud.gd's draw_prims must give a `kind` confirm at centre `c`, alpha `a`, in drawing order (see 3 above).
static func want_paint(kind: String, c: Vector2, a: float) -> Array:
	var w: float = W[kind]
	var dark := Color(0, 0, 0, DARK_A * a)
	var col := Color(CUE[kind], a)
	var out: Array = []
	var dia := PackedVector2Array([c + Vector2(0, -DIAMOND), c + Vector2(DIAMOND, 0), c + Vector2(0, DIAMOND), c + Vector2(-DIAMOND, 0)])
	if kind == "head":
		var loop := dia.duplicate()
		loop.append(dia[0])
		out.append({"op": "polyline", "points": loop, "color": dark, "width": DIAMOND_RIM})
	for k in 2:  # every line dark (w + 2), then every line in colour (w)
		for i in 4:
			var d: Vector2 = DIAG[i]
			out.append({"op": "line", "from": c + d * R[kind][0], "to": c + d * R[kind][1], "color": dark if k == 0 else col,
				"width": w + UNDER if k == 0 else w})
	if kind == "head":
		out.append({"op": "polygon", "points": dia, "color": col})
	if kind == "kill":
		out.append({"op": "arc", "center": c, "radius": RING, "from": 0.0, "to": TAU, "color": dark, "width": w + UNDER})
		out.append({"op": "arc", "center": c, "radius": RING, "from": 0.0, "to": TAU, "color": col, "width": w})
	return out

## Each call as "<op> <dark|colour> <width>", for the order check.
static func op_names(ops: Array) -> Array:
	var out: Array = []
	for o in ops:
		var k: Color = o.color
		out.append("%s %s %.1f" % [o.op, "dark" if k.r == 0.0 and k.g == 0.0 and k.b == 0.0 else "colour", float(o.get("width", 0.0))])
	return out

static func _pts_equal(a: PackedVector2Array, b: PackedVector2Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if a[i].distance_to(b[i]) > 1e-4:
			return false
	return true

## The confirm item `it` (kind `kind`, centre `c`) as hud.gd's _draw_item + draw_prims paint it, against want_paint:
## the calls and their order, each call's width, colour (alpha) and geometry, and pr.width itself.
static func paint_errors(label: String, kind: String, it: Dictionary, c: Vector2) -> Array:
	var e: Array = []
	var pr: Dictionary = it.prims
	if absf(float(pr.width) - float(W[kind])) > 1e-6:
		e.append("%s %s: pr.width %.2f, want %.2f" % [label, kind, pr.width, W[kind]])
	var col: Color = it.color
	if not Color(col, 1.0).is_equal_approx(CUE[kind]):
		e.append("%s %s: the confirm's colour %s, want %s" % [label, kind, Color(col, 1.0), CUE[kind]])
	var d := drawn(it)
	if d.has("error"):
		return e + ["%s %s: %s" % [label, kind, d.error]]
	var got: Array = d.ops
	var want := want_paint(kind, c, col.a)
	var got_names := op_names(got)
	var want_names := op_names(want)
	if got_names != want_names:
		return e + ["%s %s (a %.2f): paints %s, want %s" % [label, kind, col.a, str(got_names), str(want_names)]]
	for i in want.size():
		var g: Dictionary = got[i]
		var x: Dictionary = want[i]
		var bad: Array = []
		if not (g.color as Color).is_equal_approx(x.color):
			bad.append("colour %s, want %s" % [g.color, x.color])
		if x.has("width") and absf(float(g.width) - float(x.width)) > 1e-6:
			bad.append("width %.2f, want %.2f" % [g.width, x.width])
		match x.op:
			"line":
				if (g.from as Vector2).distance_to(x.from) > 1e-4 or (g.to as Vector2).distance_to(x.to) > 1e-4:
					bad.append("runs %s-%s, want %s-%s" % [g.from - c, g.to - c, x.from - c, x.to - c])
			"polyline", "polygon":
				if not _pts_equal(g.points, x.points):
					bad.append("points %s, want %s" % [g.points, x.points])
			"arc":
				if (g.center as Vector2).distance_to(x.center) > 1e-4 or absf(float(g.radius) - float(x.radius)) > 1e-6 \
						or absf(float(g.from) - float(x.from)) > 1e-6 or absf(float(g.to) - float(x.to)) > 1e-6:
					bad.append("arc at %s r %.2f %.3f-%.3f, want %s r %.2f 0-TAU" % [g.center, g.radius, g.from, g.to, x.center, x.radius])
		if not bad.is_empty():
			e.append("%s %s (a %.2f): call %d (%s): %s" % [label, kind, col.a, i, want_names[i], ", ".join(PackedStringArray(bad))])
	return e

## The crosshair hud.gd draws from item `it` against the gap `want` (720p px): each arm from c + d × want to
## c + d × (want + 9), a dark 4 px line under a 2 px one, and the centre dot.
static func arm_errors(label: String, it: Dictionary, want: float) -> Array:
	var d := drawn(it)
	if d.has("error"):
		return ["%s: %s" % [label, d.error]]
	var e: Array = []
	var c: Vector2 = it.center
	var ls: Array = d.lines
	if ls.size() != 2 * ARMS.size():
		return ["%s: %d crosshair lines drawn, want %d (each arm dark under light)" % [label, ls.size(), 2 * ARMS.size()]]
	for i in ARMS.size():
		for k in 2:
			var l: Dictionary = ls[i * 2 + k]
			var a: Vector2 = l.from - c
			var b: Vector2 = l.to - c
			var dir: Vector2 = ARMS[i]
			if a.distance_to(dir * want) > 1e-4 or b.distance_to(dir * (want + ARM_LEN)) > 1e-4:
				e.append("%s: arm %s drawn from %s to %s off the centre, want %s to %s (the gap %.3f, %d px long)" % [label, dir,
					a, b, dir * want, dir * (want + ARM_LEN), want, int(ARM_LEN)])
			var w: float = l.width
			if absf(w - (4.0 if k == 0 else 2.0)) > 1e-6:
				e.append("%s: arm %s line %d is %.1f px wide, want %.1f" % [label, dir, k, w, 4.0 if k == 0 else 2.0])
	var dots: Array = d.circles
	if dots.size() != 1 or not (dots[0].center as Vector2).is_equal_approx(c) or absf(float(dots[0].radius) - 1.6) > 1e-6:
		e.append("%s: the centre dot is %s, want one of radius 1.6 at %s" % [label, str(dots), c])
	return e

func _gap_rule() -> Array:
	var e: Array = []
	for s in [0.0, 0.004, 0.01, 0.02, 0.05, 0.1]:
		var out: Array = Hud.build_overlay(state({"spread": s}))
		var xs := items(out, "crosshair")
		if xs.size() != 1:
			e.append("spread %.3f: %d crosshairs drawn, want 1" % [s, xs.size()])
			continue
		if absf(float(xs[0].gap) - (5.0 + s * 420.0)) > 1e-4:
			e.append("spread %.3f: gap %.4f, want 5 + spread × 420 = %.4f" % [s, xs[0].gap, 5.0 + s * 420.0])
		if not (xs[0].center as Vector2).is_equal_approx(SIZE * 0.5):
			e.append("the crosshair is drawn at %s, not the centre %s" % [xs[0].center, SIZE * 0.5])
		# the lines hud.gd draws from the item start at that gap
		e.append_array(arm_errors("spread %.3f drawn" % s, xs[0], 5.0 + s * 420.0))
	for row in [["hip", HIP, GAP_REST], ["aim", AIM, GAP_AIM], ["run", HIP * MOVE_MULT, GAP_RUN],
			["air", HIP * AIR_MULT, GAP_AIR], ["one shot", HIP + BLOOM, GAP_SHOT]]:
		var g := gap_of(Hud.build_overlay(state({"spread": row[1]})))
		if absf(g - float(row[2])) > 0.001:
			e.append("%s spread: gap %.3f px, want %.3f" % [row[0], g, row[2]])
	# the tuning the live part relies on is still Godot's
	var r: Dictionary = T.RIFLE
	for row in [["spread_hip", HIP], ["spread_aim", AIM], ["move_mult", MOVE_MULT], ["air_mult", AIR_MULT],
			["bloom_per_shot", BLOOM], ["bloom_recover", 8.0 * PI / 180.0]]:
		if absf(float(r[row[0]]) - float(row[1])) > 1e-9:
			e.append("tuning.gd RIFLE.%s is %.6f, want %.6f" % [row[0], r[row[0]], row[1]])
	return e

func _x_reach() -> Array:
	var e: Array = []
	var c := SIZE * 0.5
	for kind in ["body", "head", "kill"]:
		var cf := items(Hud.build_overlay(state({"hit_kind": kind, "hit_t": 0.1})), "confirm")
		if cf.size() != 1:
			e.append("%s: %d confirms drawn, want 1" % [kind, cf.size()])
			continue
		e.append_array(x_errors("pure", kind, cf[0].prims, c))
		# the paint, at full show (a = 1) and half faded (a = 0.5: the underlay at 0.8 × a)
		var show: float = Hud.KILL_SHOW if kind == "kill" else Hud.HIT_SHOW
		for a in [1.0, 0.5]:
			var pf := items(Hud.build_overlay(state({"hit_kind": kind, "hit_t": show * a})), "confirm")
			if pf.size() != 1 or absf((pf[0].color as Color).a - a) > 1e-6:
				e.append("%s: the confirm at hit_t %.3f is %s, want one at alpha %.2f" % [kind, show * a, str(pf), a])
				continue
			e.append_array(paint_errors("pure paint", kind, pf[0], c))
	return e

## The gap the live overlay draws now, and what the player's own spread gives (hud.gd:768, :815).
static func live_gap(hud: Node, me: Node) -> Array:
	return [gap_of(hud.overlay_prims()), 5.0 + (float(me.current_spread()) + float(me.rifle.bloom)) * 420.0]

## The arms hud.gd draws from the live overlay's crosshair item now, against the own spread's gap `want`.
static func live_arms(label: String, hud: Node, want: float) -> Array:
	var xs := items(hud.overlay_prims(), "crosshair")
	if xs.size() != 1:
		return ["live %s: %d crosshairs drawn, want 1" % [label, xs.size()]]
	return arm_errors("live %s drawn" % label, xs[0], want)

func _live(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var run_speed: float = float(T.MOVE[me.species].run)
	await Kit.physics(tree, 40)  # land on the ground
	await tree.process_frame
	# at rest
	var g := live_gap(hud, me)
	if not me.is_on_floor() or Vector2(me.velocity.x, me.velocity.z).length() > 0.001:
		e.append("setup: the player is not standing still on the floor")
	if absf(g[0] - g[1]) > 1e-4 or absf(g[0] - GAP_REST) > 0.01:
		e.append("at rest: gap %.3f px, want %.3f (own spread gives %.3f)" % [g[0], GAP_REST, g[1]])
	e.append_array(live_arms("at rest", hud, g[1]))
	# one shot's bloom on top (read before the rifle's next physics frame recovers it)
	me.rifle.bloom = BLOOM
	g = live_gap(hud, me)
	if absf(g[0] - GAP_SHOT) > 0.01:
		e.append("rest + one shot's bloom: gap %.3f px, want %.3f" % [g[0], GAP_SHOT])
	me.rifle.bloom = 0.0
	# aiming
	Input.action_press("aim")
	await Kit.physics(tree, 3)
	g = live_gap(hud, me)
	if not me.aiming or absf(g[0] - g[1]) > 1e-4 or absf(g[0] - GAP_AIM) > 0.01:
		e.append("aiming (%s): gap %.3f px, want %.3f (own spread gives %.3f)" % [me.aiming, g[0], GAP_AIM, g[1]])
	Input.action_release("aim")
	await Kit.physics(tree, 3)
	# running: the speed opens it up to × move_mult at the run speed
	Input.action_press("move_forward")
	var widest := 0.0
	for i in 30:
		await tree.physics_frame
		g = live_gap(hud, me)
		widest = maxf(widest, g[0])
		if absf(g[0] - g[1]) > 1e-4:
			e.append("running, frame %d: gap %.3f px is not the own spread's %.3f" % [i, g[0], g[1]])
			break
	var hs := Vector2(me.velocity.x, me.velocity.z).length()
	g = live_gap(hud, me)
	if absf(hs - run_speed) > 0.05:
		e.append("setup: running at %.2f m/s, want the run speed %.2f" % [hs, run_speed])
	elif absf(g[0] - GAP_RUN) > 0.01 or absf(widest - GAP_RUN) > 0.01:
		e.append("running: gap %.3f px (widest %.3f), want %.3f" % [g[0], widest, GAP_RUN])
	e.append_array(live_arms("running", hud, g[1]))
	Input.action_release("move_forward")
	await Kit.physics(tree, 30)
	g = live_gap(hud, me)
	if absf(g[0] - GAP_REST) > 0.01:
		e.append("stopped: gap %.3f px, want %.3f" % [g[0], GAP_REST])
	# in the air: × air_mult
	Input.action_press("jump")
	var air := 0
	for i in 12:
		await tree.physics_frame
		if me.is_on_floor():
			continue
		air += 1
		g = live_gap(hud, me)
		var moving := clampf(Vector2(me.velocity.x, me.velocity.z).length() / run_speed, 0.0, 1.0)
		var want := 5.0 + HIP * (1.0 + (MOVE_MULT - 1.0) * moving) * AIR_MULT * 420.0
		if absf(g[0] - g[1]) > 1e-4 or absf(g[0] - want) > 0.01:
			e.append("in the air, frame %d: gap %.3f px, want %.3f" % [i, g[0], want])
			break
	Input.action_release("jump")
	g = live_gap(hud, me)
	if air < 5:
		e.append("setup: the jump left the floor for %d of 12 frames" % air)
	elif me.is_on_floor() or absf(g[0] - GAP_AIR) > 0.05:
		e.append("standing in the air: gap %.3f px, want %.3f" % [g[0], GAP_AIR])
	e.append_array(live_arms("in the air", hud, g[1]))
	await Kit.physics(tree, 60)
	g = live_gap(hud, me)
	if not me.is_on_floor() or absf(g[0] - GAP_REST) > 0.01:
		e.append("landed: gap %.3f px, want %.3f" % [g[0], GAP_REST])
	# the confirms the overlay draws on the player's own hits
	var c: Vector2 = hud._cross.size * 0.5
	for row in [["body", {"kill": false, "head": false}], ["head", {"kill": false, "head": true}], ["kill", {"kill": true, "head": false}]]:
		me.hit_confirmed.emit(row[1])
		var cf := items(hud.overlay_prims(), "confirm")
		if cf.size() != 1 or cf[0].kind != row[0]:
			e.append("live: a %s hit draws %s" % [row[0], str(cf.map(func(it): return it.kind))])
			continue
		e.append_array(x_errors("live", row[0], cf[0].prims, c))
		e.append_array(paint_errors("live paint", row[0], cf[0], c))
	return e

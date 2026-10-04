extends CanvasLayer
## HUD (lane G-GAME; W15 G-HUD, docs/qa/w15/HUD_CONTRACT.md, whose strings these are): team scores racing to 60, the
## match timer, the slab line, the crosshair with its hit cues, the slab marker, YOU: <TEAM> over the hit points, ammo,
## the takedown feed, the death panel, the controls hint, the PLACEHOLDER tag and the winner screen with the rematch
## prompt. Reads `game` (match.gd) every frame.
## W15: every cue carries its meaning in its shape and words; colour is extra. The slab marker's state, the four hit
## cues and the killer's team glyph are built by pure static functions (marker_spec, marker_shapes, marker_box,
## place_marker, hit_cue, wedge_dir, team_glyph, death_lines) that the tests read directly; the instance code only
## projects through the camera, places and draws them.

const T := preload("res://game/tuning.gd")

## §1 The slab marker hangs MARKER_LIFT m over the slab's centre: two lines of words (`SLAB  <N> m`, then the state
## word) above the shape, a diamond MARKER_R px from its centre to each tip. It stays inside MARKER_SAFE (px off the
## left, top, right and bottom: below the scores, the timer and the slab line, above the hit points and the ammo); off
## screen it clamps to that edge with both lines. If its box covers another living pet's box on screen it moves up
## until clear (MARKER_CLEAR px of air), by at most MARKER_MAX_LIFT px and never above the safe top, else just below
## the pet (place_marker). It hides while the player stands on the slab and once the match is over, and
## while the player is down: the death panel then gives the distance from where they come back, and the marker's own
## distance (from where they fell) would contradict it.
const MARKER_LIFT := 4.5
const MARKER_R := 10.0
const MARKER_PX := [14, 15]
const MARKER_GAP := 3.0
const MARKER_MAX_LIFT := 120.0
const MARKER_CLEAR := 2.0
const MARKER_SAFE := [16.0, 110.0, 16.0, 112.0]
## The contested shape: the diamond's two halves stand SPLIT_GAP px apart, and a bar SPLIT_BAR px thick lies in the gap,
## reaching SPLIT_REACH px past the diamond's side tips.
const SPLIT_GAP := 3.0
const SPLIT_BAR := 2.0
const SPLIT_REACH := 5.0
## State colours (the slab line uses them too): neutral white, contested amber, a holder its team colour lightened.
const NEUTRAL_COLOR := Color(0.9, 0.92, 0.95)
const CONTESTED_COLOR := Color(1.0, 0.65, 0.2)
const HOLDER_LIGHTEN := 0.35

## §3 Hit cues. A confirm shows HIT_SHOW s (a kill KILL_SHOW s) at the crosshair. A received hit puts a wedge on a ring
## HIT_RING px around the crosshair toward the attacker (fading over WEDGE_FADE s), a white chip on the HP bar for the
## HP lost (draining over CHIP_DRAIN s) and the red flash, never above FLASH_MAX alpha.
const HIT_SHOW := 0.18
const KILL_SHOW := 0.35
const HIT_RING := 110.0
const WEDGE_FADE := 0.6
const CHIP_DRAIN := 0.4
const FLASH_MAX := 0.25
const CUE_COLORS := {"body": Color(1, 1, 1), "head": Color(1.0, 0.85, 0.2), "kill": Color(1.0, 0.25, 0.2),
	"received": Color(1.0, 0.45, 0.36)}
const HP_W := 240.0
const HP_H := 14.0

var game: Node
var _score: Array[Label] = []
var _fill: Array[ColorRect] = []
var _timer: Label
var _slab: Label
var _you: Label
var _hp: Label
var _hp_bg: ColorRect
var _hp_fill: ColorRect
var _chip: ColorRect
var _ammo: Label
var _center: Label
var _feed: Label
var _hint: Label
var _winner: Control
var _win_title: Label
var _win_sub: Label
var _flash: ColorRect
var _cross: Control
var _death: PanelContainer
var _death_by: Label
var _death_glyph: Glyph
var _death_team: Label
var _death_you: Label
var _death_base: Label
var _death_in: Label
## The slab marker this frame (marker_frame()): drawn by the overlay, read by tests.
var marker := {"visible": false}
## The death panel's lines this frame (death_lines()); empty while the player is up.
var death_text := PackedStringArray()
## The hit confirm on show: "body", "head" or "kill", for hit_t more seconds.
var hit_kind := "body"
var hit_t := 0.0
## Received hits, one wedge per attacker: {from: the attacker, pos: where it stood at its last hit, t: seconds left}.
var wedges: Array = []
## The HP chip: the HP at its right end, how fast it drains (HP per second) and the HP it last saw.
var chip_top := 0.0
var _chip_rate := 0.0
var _hp_seen := 0.0
## Who took the local player down last: {name, team}, or {} for none (the map: a fall).
var down_by := {}
var _dmg_t := 0.0
var _hooked: Node = null
var _hint_t := 14.0

## The full-screen canvas for the marker, the crosshair and the hit cues; the HUD draws on it.
class Overlay extends Control:
	var hud: Node
	func _draw() -> void:
		hud.draw_overlay(self)

## The killer team's glyph in the death panel's first line; the HUD draws it.
class Glyph extends Control:
	var hud: Node
	var team := 0
	func _draw() -> void:
		hud.draw_glyph(self, team)

func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_flash = ColorRect.new()
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.color = Color(0.8, 0.05, 0.05, 0.0)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_flash)
	_cross = Overlay.new()
	_cross.hud = self
	_cross.set_anchors_preset(Control.PRESET_FULL_RECT)
	_cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_cross)
	# top: [CORGI COMPANY 12 ====]  2:41  [==== 7 CAT CADRE]
	var top := HBoxContainer.new()
	top.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	top.position = Vector2(-330, 14)
	top.size = Vector2(660, 60)
	top.add_theme_constant_override("separation", 18)
	root.add_child(top)
	for t in 2:
		var box := VBoxContainer.new()
		box.custom_minimum_size = Vector2(250, 0)
		var l := _label(T.TEAM_NAMES[t] + "  0", 22, T.TEAM_COLORS[t].lightened(0.45))
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if t == 0 else HORIZONTAL_ALIGNMENT_LEFT
		box.add_child(l)
		_score.append(l)
		var bg := ColorRect.new()
		bg.custom_minimum_size = Vector2(250, 8)
		bg.color = Color(0, 0, 0, 0.55)
		var f := ColorRect.new()
		f.color = T.TEAM_COLORS[t].lightened(0.15)
		f.size = Vector2(0, 8)
		bg.add_child(f)
		_fill.append(f)
		box.add_child(bg)
		if t == 1:
			_timer = _label("3:00", 30, Color.WHITE)
			_timer.custom_minimum_size = Vector2(110, 0)
			_timer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			top.add_child(_timer)
		top.add_child(box)
	_slab = _label("SLAB  NEUTRAL", 18, Color.WHITE)
	_slab.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_slab.position = Vector2(-300, 76)
	_slab.size = Vector2(600, 26)
	_slab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_slab)
	var tag := _label("PLACEHOLDER PETS", 12, Color(1.0, 0.78, 0.3, 0.85))
	tag.position = Vector2(14, 10)
	root.add_child(tag)
	_feed = _label("", 15, Color(1, 1, 1, 0.9))
	_feed.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_feed.position = Vector2(-360, 12)
	_feed.size = Vector2(346, 100)
	_feed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(_feed)
	# bottom left: YOU: <TEAM> and the hit points over the HP bar (with the chip); bottom right: ammo
	_hp_bg = ColorRect.new()
	_hp_bg.color = Color(0, 0, 0, 0.55)
	_hp_bg.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	_hp_bg.position = Vector2(24, -46)
	_hp_bg.size = Vector2(HP_W, HP_H)
	root.add_child(_hp_bg)
	_hp_fill = ColorRect.new()
	_hp_fill.color = Color(0.55, 0.9, 0.45)
	_hp_fill.size = Vector2(HP_W, HP_H)
	_hp_bg.add_child(_hp_fill)
	_chip = ColorRect.new()
	_chip.color = Color(1, 1, 1, 0.95)
	_chip.size = Vector2(0, HP_H)
	_chip.visible = false
	_hp_bg.add_child(_chip)
	var edge := ColorRect.new()  # a dark seam where the chip meets the fill: a segment of its own without colour
	edge.color = Color(0, 0, 0, 0.75)
	edge.size = Vector2(2, HP_H)
	_chip.add_child(edge)
	_hp = _label("120", 22, Color.WHITE)
	_hp.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	_hp.position = Vector2(24, -80)
	root.add_child(_hp)
	_you = _label("YOU: " + T.TEAM_NAMES[0], 15, T.TEAM_COLORS[0].lightened(0.45))
	_you.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	_you.position = Vector2(24, -71)
	_you.size = Vector2(HP_W, 22)
	_you.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(_you)
	_ammo = _label("30 / 30", 26, Color.WHITE)
	_ammo.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	_ammo.position = Vector2(-260, -60)
	_ammo.size = Vector2(236, 40)
	_ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(_ammo)
	_center = _label("", 26, Color.WHITE)
	_center.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_center.position = Vector2(-400, 60)
	_center.size = Vector2(800, 80)
	_center.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_center)
	_build_death(root)
	_hint = _label("WASD / stick move · mouse / stick look · Space / A jump · LMB / RT fire · RMB / LT aim · Shift sprint · R reload\n"
		+ "Hold the slab alone to score · Esc frees the mouse · F2 / Back: 1v1 or 2v2", 14, Color(1, 1, 1, 0.85))
	_hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_hint.position = Vector2(-500, -120)
	_hint.size = Vector2(1000, 44)
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_hint)
	# winner screen
	_winner = ColorRect.new()
	(_winner as ColorRect).color = Color(0.02, 0.02, 0.04, 0.62)
	_winner.set_anchors_preset(Control.PRESET_FULL_RECT)
	_winner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_winner.visible = false
	root.add_child(_winner)
	_win_title = _label("", 58, Color.WHITE)
	_win_title.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_win_title.position = Vector2(-500, -110)
	_win_title.size = Vector2(1000, 80)
	_win_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_winner.add_child(_win_title)
	_win_sub = _label("", 22, Color.WHITE)
	_win_sub.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_win_sub.position = Vector2(-500, -10)
	_win_sub.size = Vector2(1000, 120)
	_win_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_winner.add_child(_win_sub)

## §2 The death panel, four lines centred on the screen: who took you down (the killer's name, then its team glyph and
## team name), your team, where you come back and how far that is from the slab, and the countdown. A dim backing,
## sized to the lines, keeps lit scenery behind them from crossing the words.
func _build_death(root: Control) -> void:
	_death = PanelContainer.new()
	var back := StyleBoxFlat.new()
	back.bg_color = Color(0.01, 0.015, 0.03, 0.55)
	back.set_corner_radius_all(6)
	back.content_margin_left = 28.0
	back.content_margin_right = 28.0
	back.content_margin_top = 8.0
	back.content_margin_bottom = 10.0
	_death.add_theme_stylebox_override("panel", back)
	_death.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_death.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_death.grow_vertical = Control.GROW_DIRECTION_BOTH
	_death.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_death.visible = false
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 2)
	lines.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_death.add_child(lines)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 9)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_death_by = _label("", 26, Color.WHITE)
	row.add_child(_death_by)
	_death_glyph = Glyph.new()
	_death_glyph.hud = self
	_death_glyph.custom_minimum_size = Vector2(22, 22)
	_death_glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_death_glyph.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(_death_glyph)
	_death_team = _label("", 26, Color.WHITE)
	row.add_child(_death_team)
	lines.add_child(row)
	_death_you = _label("", 18, Color.WHITE)
	_death_base = _label("", 20, Color.WHITE)
	_death_in = _label("", 24, Color.WHITE)
	for l in [_death_you, _death_base, _death_in]:
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		lines.add_child(l)
	root.add_child(_death)

func _label(text: String, px: int, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	var s := LabelSettings.new()
	s.font_size = px
	s.font_color = col
	s.outline_size = maxi(3, px / 5)
	s.outline_color = Color(0, 0, 0, 0.85)
	l.label_settings = s
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _font() -> Font:
	return _cross.get_theme_default_font() if _cross != null else ThemeDB.fallback_font

func slab_color() -> Color:
	return marker_spec(game.slab_state).color

# --- pure geometry and words (tests read these) ---------------------------------------------------------------------

## The marker's state from match.gd slab_state: {word, shape, color}. Nobody on the slab: NEUTRAL, a hollow diamond,
## white. One team alone: its name, a filled diamond, its colour lightened. Both: CONTESTED, the split diamond, amber.
static func marker_spec(st: Dictionary) -> Dictionary:
	if bool(st.get("contested", false)):
		return {"word": "CONTESTED", "shape": "split", "color": CONTESTED_COLOR}
	var h := int(st.get("holder", -1))
	if h >= 0:
		return {"word": T.TEAM_NAMES[h], "shape": "filled", "color": T.TEAM_COLORS[h].lightened(HOLDER_LIGHTEN)}
	return {"word": "NEUTRAL", "shape": "hollow", "color": NEUTRAL_COLOR}

## The marker's two lines: the camera's ground distance to the slab's centre in whole metres, then the state word.
static func marker_lines(st: Dictionary, dist_m: int) -> PackedStringArray:
	return PackedStringArray(["SLAB  %d m" % dist_m, marker_spec(st).word])

## A diamond around `c`, `r` px from its centre to each tip (top, right, bottom, left).
static func _diamond(c: Vector2, r: float) -> PackedVector2Array:
	return PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)])

## A shape made of primitives, as the marker, the hit cues and draw_prims use them: {lines: [[a, b]], fills:
## [PackedVector2Array] (filled convex polygons), outlines: [PackedVector2Array] (closed polylines), rings: [[centre,
## radius]], width: px}.
static func _prims() -> Dictionary:
	return {"lines": [], "fills": [], "outlines": [], "rings": [], "width": 2.5}

## The marker's shape around `c` (MARKER_R px to a tip): "hollow" a diamond outline; "filled" a solid diamond; "split"
## the diamond's top and bottom halves SPLIT_GAP px apart with a bar in the gap that reaches past both side tips.
static func marker_shapes(shape: String, c: Vector2, r: float = MARKER_R) -> Dictionary:
	var out := _prims()
	match shape:
		"hollow":
			out.outlines.append(_diamond(c, r))
		"filled":
			out.fills.append(_diamond(c, r))
		"split":
			var g := SPLIT_GAP
			var w := r - g  # the half-width of the diamond at the gap's edges
			out.fills.append(PackedVector2Array([c + Vector2(0, -r), c + Vector2(w, -g), c + Vector2(-w, -g)]))
			out.fills.append(PackedVector2Array([c + Vector2(-w, g), c + Vector2(w, g), c + Vector2(0, r)]))
			var x := r + SPLIT_REACH
			var b := SPLIT_BAR * 0.5
			out.fills.append(PackedVector2Array([c + Vector2(-x, -b), c + Vector2(x, -b), c + Vector2(x, b), c + Vector2(-x, b)]))
	return out

## The marker's box around its shape's centre: the two lines of words (sizes l1, l2 in px) stacked over the shape, the
## second MARKER_GAP px over its top tip; as wide as the widest line or the split shape's bar.
static func marker_box(l1: Vector2, l2: Vector2) -> Rect2:
	var w := maxf(maxf(l1.x, l2.x), 2.0 * (MARKER_R + SPLIT_REACH) + 2.0)
	var above := MARKER_R + MARKER_GAP + l1.y + l2.y
	return Rect2(-w * 0.5, -above, w, above + MARKER_R + 1.0)

## Where the marker's shape goes on screen (contract §1 "Placement, in this order"; the canvas is always 720 units tall,
## project stretch canvas_items, so the contract's 720p pixels are these):
## 1. the anchor `a` is clamped so the box `off` (around the shape) stays inside `safe`;
## 2. while the box covers a rect in `pets` (the other living pets' boxes), it moves up until clear with MARKER_CLEAR
##    to spare, by at most MARKER_MAX_LIFT in all and never above the safe top (the scores, timer and slab line);
## 3. if that cannot clear them, the box goes just below the lowest pet box it still covers (MARKER_CLEAR under it),
##    kept inside the safe bottom, provided it clears every pet there;
## 4. if neither clears, it keeps the lifted position of step 2.
## Nothing clamps after the dodge. Returns {pos, raw (after step 1), lift (px up; negative when it went below), dodge:
## "none", "lift", "below" or "blocked"}. `screen` is unused since revision 3 and kept for callers.
static func place_marker(a: Vector2, off: Rect2, pets: Array, safe: Rect2, _screen: Rect2) -> Dictionary:
	var p := Vector2(clampf(a.x, safe.position.x - off.position.x, safe.end.x - off.end.x),
		clampf(a.y, safe.position.y - off.position.y, safe.end.y - off.end.y))
	var raw := p
	var room := minf(MARKER_MAX_LIFT, (raw.y + off.position.y) - safe.position.y)  # up to the cap or the safe top
	var dodge := "none"
	for _i in pets.size() + 1:
		var need := _overlap_need(Rect2(p + off.position, off.size), pets)
		var step := minf(need, room - (raw.y - p.y))
		if step <= 0.0:
			break
		p.y -= step
		dodge = "lift"
	var box := Rect2(p + off.position, off.size)
	if _overlap_need(box, pets) > 0.0:
		var low := -INF  # the lowest bottom of the pet boxes it still covers
		for b in pets:
			var pr: Rect2 = b
			if box.intersects(pr):
				low = maxf(low, pr.end.y)
		var under := Vector2(p.x, minf(low + MARKER_CLEAR - off.position.y, safe.end.y - off.end.y))
		if _overlap_need(Rect2(under + off.position, off.size), pets) <= 0.0:
			p = under
			dodge = "below"
		else:
			dodge = "blocked"
	return {"pos": p, "raw": raw, "lift": raw.y - p.y, "dodge": dodge}

## How far `box` must move up to clear every rect in `pets` it covers (MARKER_CLEAR to spare); 0 when it covers none.
static func _overlap_need(box: Rect2, pets: Array) -> float:
	var need := 0.0
	for b in pets:
		var pr: Rect2 = b
		if box.intersects(pr):
			need = maxf(need, box.end.y - pr.position.y + MARKER_CLEAR)
	return need

## The ground direction a camera faces (unit, x and z): its forward, or its up when it looks straight down or up.
static func _ground_fwd(xf: Transform3D) -> Vector2:
	var f := -xf.basis.z
	var g := Vector2(f.x, f.z)
	if g.length() < 0.05:
		var u := xf.basis.y * signf(-f.y)
		g = Vector2(u.x, u.z)
	return g.normalized() if g.length() > 1e-6 else Vector2(0, -1)

## A stand-in screen point for a world point behind the camera, off `screen`: below its bottom edge (above the top when
## the point is ahead on the ground but over a view pitched down), toward the side it lies on, so the clamp holds the
## marker on that edge.
static func behind_point(xf: Transform3D, p: Vector3, screen: Rect2) -> Vector2:
	var to := p - xf.origin
	var fh := _ground_fwd(xf)
	var rh := Vector2(xf.basis.x.x, xf.basis.x.z).normalized()
	var th := Vector2(to.x, to.z)
	var bearing := atan2(th.dot(rh), th.dot(fh))
	var x := screen.get_center().x + sin(bearing) * screen.size.x * 0.6
	var up := absf(bearing) < PI * 0.5 and to.dot(xf.basis.y) > 0.0
	return Vector2(x, screen.position.y - 1e4 if up else screen.end.y + 1e4)

## A hit cue around the crosshair `c` (prims, see _prims; colour CUE_COLORS[kind]): "body" an X of four short lines;
## "head" the same X with a small filled diamond in its centre; "kill" a larger X with an outline ring 18 px across;
## "received" a filled triangle on a ring HIT_RING px around `c`, its tip pointing out along `dir` (the attacker's side
## on screen, wedge_dir()).
static func hit_cue(kind: String, c: Vector2, dir := Vector2.UP) -> Dictionary:
	var out := _prims()
	if kind == "received":  # an arrowhead 24 px long and 16 px wide, so its tip reads at any angle
		var d := dir.normalized() if dir.length() > 1e-4 else Vector2.UP
		var n := Vector2(-d.y, d.x)
		var base := c + d * (HIT_RING - 10.0)
		out.fills.append(PackedVector2Array([c + d * (HIT_RING + 14.0), base + n * 8.0, base - n * 8.0]))
		return out
	var kill := kind == "kill"
	var r0 := 6.0 if kill else 5.0
	var r1 := 15.0 if kill else 10.0
	for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
		out.lines.append([c + d * r0, c + d * r1])
	if kill:
		out.width = 3.0
		out.rings.append([c, 9.0])
	elif kind == "head":
		out.fills.append(_diamond(c, 4.5))
	return out

## Where an attacker at `from` is from a pet at `me`, relative to the camera's facing (`cam` its transform), on the
## ground, as a unit screen direction: up = ahead, right = to its right, down = behind, left = to its left.
static func wedge_dir(cam: Transform3D, me: Vector3, from: Vector3) -> Vector2:
	var fh := _ground_fwd(cam)
	var rh := Vector2(cam.basis.x.x, cam.basis.x.z).normalized()
	var th := Vector2(from.x - me.x, from.z - me.z)
	var v := Vector2(th.dot(rh), -th.dot(fh))
	return v.normalized() if v.length() > 1e-4 else Vector2.UP

## The team glyph centred on `c`, `r` px from its centre to a corner: Corgi Company (team 0) a square, Cat Cadre a
## triangle, point up.
static func team_glyph(team: int, c: Vector2, r: float) -> PackedVector2Array:
	if team == 0:
		var s := r * 0.78
		return PackedVector2Array([c + Vector2(-s, -s), c + Vector2(s, -s), c + Vector2(s, s), c + Vector2(-s, s)])
	return PackedVector2Array([c + Vector2(0, -r), c + Vector2(r * 0.95, r * 0.72), c + Vector2(-r * 0.95, r * 0.72)])

## The death panel's lines: `killer` is {name, team} or {} (the map: a fall), `team` the player's, `zone` match.gd
## respawn_zone(team, player) (the base; in --demo's first match THE SLAB'S EDGE, where the player really comes back;
## {} before the match has spawns: the line is left out) and `left` the respawn countdown (s).
static func death_lines(killer: Dictionary, team: int, zone: Dictionary, left: float) -> PackedStringArray:
	var out := PackedStringArray()
	if killer.is_empty():
		out.append("TAKEN DOWN BY THE LOT")
	else:
		out.append("TAKEN DOWN BY %s  ·  %s" % [killer.name, T.TEAM_NAMES[int(killer.team)]])
	out.append("YOU: %s" % T.TEAM_NAMES[team])
	if not zone.is_empty():
		out.append("BACK AT %s  ·  %d m TO THE SLAB" % [zone.name, roundi(float(zone.dist))])
	out.append("BACK IN %.1f" % maxf(0.0, left))
	return out

## A pet's box on screen: the bounds of its model's body mesh (else its capsule) projected through `cam`; an empty rect
## when any corner is behind the camera.
static func pet_screen_rect(pet: Node, cam: Camera3D) -> Rect2:
	var model = pet.get("model")
	var body: Node = model.get_node_or_null("Body") if model is Node else null
	var box: AABB
	var xf: Transform3D
	if body is MeshInstance3D and (body as MeshInstance3D).mesh != null:
		box = (body as MeshInstance3D).get_aabb()
		xf = (body as MeshInstance3D).global_transform
	else:
		var sp := int(pet.species)
		var r := float(T.MOVE[sp].radius)
		box = AABB(Vector3(-r, 0.0, -r), Vector3(2.0 * r, T.height(sp), 2.0 * r))
		xf = (pet as Node3D).global_transform
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for i in 8:
		var w: Vector3 = xf * box.get_endpoint(i)
		if cam.is_position_behind(w):
			return Rect2()
		var s := cam.unproject_position(w)
		lo = lo.min(s)
		hi = hi.max(s)
	return Rect2(lo, hi - lo)

# --- per frame -------------------------------------------------------------------------------------------------------

## The slab marker as `cam` (default: the viewport's camera) sees it: {visible} (false with no player, the player down
## or on the slab, or the match over) and, when visible: spec (marker_spec), lines, dist (m), anchor (the projected
## anchor, or its stand-in off the edge when it is behind the camera), onscreen (the anchor itself is on screen), pos
## (the shape's centre), rect (the whole box), raw (the box before the dodge), lift (px), dodge (place_marker) and pets (the living pets' boxes
## it keeps clear of; not the pet whose camera this is).
func marker_frame(cam: Camera3D = null) -> Dictionary:
	if cam == null:
		cam = get_viewport().get_camera_3d()
	if game == null or game.slab == null or game.player == null or cam == null or game.over():
		return {"visible": false}
	var me: Node = game.player
	if not me.alive or game.slab.contains(me.global_position):
		return {"visible": false}
	var c: Vector3 = game.slab.center
	var a3 := c + Vector3(0, MARKER_LIFT, 0)
	var cp := cam.global_position
	var dist := roundi(Vector2(cp.x - c.x, cp.z - c.z).length())
	var spec := marker_spec(game.slab_state)
	var lines := marker_lines(game.slab_state, dist)
	var font := _font()
	var off := marker_box(font.get_string_size(lines[0], HORIZONTAL_ALIGNMENT_LEFT, -1, MARKER_PX[0]),
		font.get_string_size(lines[1], HORIZONTAL_ALIGNMENT_LEFT, -1, MARKER_PX[1]))
	var screen := get_viewport().get_visible_rect()
	var anchor: Vector2
	var onscreen := false
	if cam.is_position_behind(a3):
		anchor = behind_point(cam.global_transform, a3, screen)
	else:
		anchor = cam.unproject_position(a3)
		onscreen = screen.has_point(anchor)
	var pets: Array = []
	for p in game.pets:
		if p.alive and p.get("camera") != cam:
			var b := pet_screen_rect(p, cam)
			if b.has_area():
				pets.append(b)
	var safe := Rect2(screen.position + Vector2(MARKER_SAFE[0], MARKER_SAFE[1]),
		screen.size - Vector2(MARKER_SAFE[0] + MARKER_SAFE[2], MARKER_SAFE[1] + MARKER_SAFE[3]))
	var at := place_marker(anchor, off, pets, safe, screen)
	return {"visible": true, "spec": spec, "lines": lines, "dist": dist, "anchor": anchor, "onscreen": onscreen,
		"pos": at.pos, "rect": Rect2(at.pos + off.position, off.size), "raw": Rect2(at.raw + off.position, off.size),
		"lift": at.lift, "dodge": at.dodge, "pets": pets}

func _hook_player() -> void:
	var p: Node = game.player
	if p == _hooked:
		return
	_hooked = p
	wedges.clear()
	down_by = {}
	chip_top = 0.0
	_hp_seen = 0.0
	if p != null:
		p.hit_confirmed.connect(_on_hit_confirmed)
		p.damaged.connect(_on_damaged)
		p.died.connect(_on_player_died)

func _on_hit_confirmed(res: Dictionary) -> void:
	hit_kind = "kill" if bool(res.get("kill", false)) else ("head" if bool(res.get("head", false)) else "body")
	hit_t = KILL_SHOW if hit_kind == "kill" else HIT_SHOW

## A hit on the local player (pet.gd damaged): the red flash and a wedge toward the attacker. The HP chip follows the
## hit points themselves (_process), so a takedown without a hit (a fall) drains it too.
func _on_damaged(_amount: float, from: Node) -> void:
	_dmg_t = 0.35
	var p: Node = game.player if game != null else null
	if p == null or from == null or from == p or not is_instance_valid(from):
		return
	for wd in wedges:
		if wd.from == from:
			wd.pos = from.global_position
			wd.t = WEDGE_FADE
			return
	wedges.append({"from": from, "pos": from.global_position, "t": WEDGE_FADE})

## The local player is down: keep who did it for the death panel (match.gd pet_down carries the same pair).
func _on_player_died(_pet: Node, killer: Node) -> void:
	if killer == null or not is_instance_valid(killer):
		down_by = {}
	else:
		down_by = {"name": String(killer.display_name), "team": int(killer.team)}

## A wedge's screen direction now, from where its attacker stood at the hit, relative to the camera's facing.
func wedge_screen_dir(wd: Dictionary) -> Vector2:
	var cam := get_viewport().get_camera_3d()
	if cam == null or game == null or game.player == null:
		return Vector2.UP
	return wedge_dir(cam.global_transform, game.player.global_position, wd.pos)

func _process(delta: float) -> void:
	if game == null:
		return
	_hook_player()
	hit_t = maxf(0.0, hit_t - delta)
	_dmg_t = maxf(0.0, _dmg_t - delta)
	_hint_t -= delta
	_flash.color.a = minf(FLASH_MAX, _dmg_t * 0.5)
	for wd in wedges:
		wd.t -= delta
	wedges = wedges.filter(func(wd): return wd.t > 0.0)
	for t in 2:
		_score[t].text = ("%s  %d" % [T.TEAM_NAMES[t], game.score[t]]) if t == 0 else ("%d  %s" % [game.score[t], T.TEAM_NAMES[t]])
		var w := 250.0 * clampf(float(game.score[t]) / float(T.WIN_SCORE), 0.0, 1.0)
		_fill[t].size = Vector2(w, 8)
		_fill[t].position.x = 0.0 if t == 1 else 250.0 - w
	if game.overtime:
		_timer.text = "OVERTIME"
		_timer.label_settings.font_color = Color(1.0, 0.6, 0.2)
	else:
		var s := int(ceil(game.time_left))
		_timer.text = "%d:%02d" % [s / 60, s % 60]
		_timer.label_settings.font_color = Color(1.0, 0.45, 0.4) if game.time_left <= 30.0 else Color.WHITE
	var st: Dictionary = game.slab_state
	if st.contested:
		_slab.text = "SLAB  CONTESTED"
	elif int(st.holder) >= 0:
		_slab.text = "SLAB  %s HOLDING  +1/s" % T.TEAM_NAMES[int(st.holder)]
	else:
		_slab.text = "SLAB  NEUTRAL"
	_slab.label_settings.font_color = slab_color()
	_slab.visible = not game.over()
	var lines := PackedStringArray()
	for f in game.feed:
		lines.append(f.text)
	_feed.text = "\n".join(lines)
	var p: Node = game.player
	_hp.visible = p != null
	_hp_bg.visible = p != null
	_you.visible = p != null
	_ammo.visible = p != null
	_hint.visible = p != null and _hint_t > 0.0 and game.playing()
	_center.text = ""
	death_text = PackedStringArray()
	if p != null:
		_you.text = "YOU: %s" % T.TEAM_NAMES[p.team]
		_you.label_settings.font_color = T.TEAM_COLORS[p.team].lightened(0.45)
		_hp.text = "%d" % int(ceil(p.hp))
		var hp := clampf(p.hp / float(T.MAX_HP), 0.0, 1.0)
		_hp_fill.size.x = HP_W * hp
		_hp_fill.color = Color(0.55, 0.9, 0.45) if p.hp > 40.0 else Color(1.0, 0.4, 0.3)
		var now := maxf(float(p.hp), 0.0)
		if now < _hp_seen:  # HP lost since the last frame: the chip runs from the HP seen, drained in CHIP_DRAIN s
			chip_top = minf(float(T.MAX_HP), maxf(chip_top, _hp_seen))
			_chip_rate = (chip_top - now) / CHIP_DRAIN
		else:
			chip_top -= _chip_rate * delta
		chip_top = maxf(chip_top, now)
		_hp_seen = now
		var chip := clampf(chip_top / float(T.MAX_HP), 0.0, 1.0) - hp
		_chip.visible = chip > 0.001
		_chip.position.x = HP_W * hp
		_chip.size.x = HP_W * maxf(chip, 0.0)
		_ammo.text = "RELOADING" if p.rifle.reloading() else "%d / %d" % [p.rifle.ammo, int(T.RIFLE.mag)]
		if not p.alive and game.playing():
			death_text = death_lines(down_by, p.team, game.respawn_zone(p.team, p), game.respawn_left(p))
		elif Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not p.using_pad and DisplayServer.get_name() != "headless" \
				and game.playing():
			_center.text = "Click to play"
	_show_death(p)
	_winner.visible = game.over()
	if _winner.visible:
		var w: int = game.winner
		_win_title.text = "DRAW" if w < 0 else "%s WINS" % T.TEAM_NAMES[w]
		_win_title.label_settings.font_color = Color.WHITE if w < 0 else T.TEAM_COLORS[w].lightened(0.4)
		var sub := "%d  –  %d" % [game.score[0], game.score[1]]
		if p != null:
			sub += "\nYou: %d takedowns · %d knockouts" % [p.kills, p.deaths]
		sub += "\n\nR / Enter / Start: rematch   ·   F2 / Back: switch 1v1 / 2v2"
		_win_sub.text = sub
	marker = marker_frame()
	_cross.queue_redraw()

## Fills the death panel's labels from death_text: line 1 splits into the killer's part, the glyph and the team name.
func _show_death(p: Node) -> void:
	_death.visible = not death_text.is_empty()
	if not _death.visible:
		return
	var by := not down_by.is_empty()
	_death_glyph.visible = by
	_death_team.visible = by
	if by:
		var kt := int(down_by.team)
		_death_by.text = "TAKEN DOWN BY %s  ·" % down_by.name
		_death_team.text = T.TEAM_NAMES[kt]
		_death_team.label_settings.font_color = T.TEAM_COLORS[kt].lightened(0.45)
		if _death_glyph.team != kt:
			_death_glyph.team = kt
			_death_glyph.queue_redraw()
	else:
		_death_by.text = death_text[0]
	_death_you.text = death_text[1]
	_death_you.label_settings.font_color = T.TEAM_COLORS[p.team].lightened(0.45)
	_death_base.visible = death_text.size() > 3
	_death_base.text = death_text[2] if death_text.size() > 3 else ""
	_death_in.text = death_text[death_text.size() - 1]

# --- drawing ---------------------------------------------------------------------------------------------------------

## Draws prims (see _prims) in `col` on `ci`, each over a dark rim (2 px round a fill) so it reads on lit and dark
## ground alike, in colour or not.
static func draw_prims(ci: CanvasItem, pr: Dictionary, col: Color) -> void:
	var dark := Color(0, 0, 0, 0.8 * col.a)
	var w: float = pr.width
	for poly in pr.fills:
		var loop: PackedVector2Array = poly.duplicate()
		loop.append(poly[0])
		ci.draw_polyline(loop, dark, 4.0, true)
	for poly in pr.outlines:
		var loop: PackedVector2Array = poly.duplicate()
		loop.append(poly[0])
		ci.draw_polyline(loop, dark, w + 2.5, true)
		ci.draw_polyline(loop, col, w, true)
	for l in pr.lines:
		ci.draw_line(l[0], l[1], dark, w + 2.0, true)
	for l in pr.lines:
		ci.draw_line(l[0], l[1], col, w, true)
	for poly in pr.fills:
		ci.draw_colored_polygon(poly, col)
	for r in pr.rings:
		ci.draw_arc(r[0], r[1], 0.0, TAU, 40, dark, w + 2.0, true)
		ci.draw_arc(r[0], r[1], 0.0, TAU, 40, col, w, true)

func draw_overlay(ci: Control) -> void:
	if game == null:
		return
	if marker.get("visible", false):
		_draw_marker(ci, marker)
	var p: Node = game.player
	if p == null or not p.alive:
		return
	var c := ci.size * 0.5
	var spread: float = p.current_spread() + p.rifle.bloom
	var gap := 5.0 + spread * 420.0
	var w := Color(1, 1, 1, 0.92)
	for d in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		ci.draw_line(c + d * gap, c + d * (gap + 9.0), Color(0, 0, 0, 0.6), 4.0)
		ci.draw_line(c + d * gap, c + d * (gap + 9.0), w, 2.0)
	ci.draw_circle(c, 1.6, w)
	if hit_t > 0.0:
		var a := clampf(hit_t / (KILL_SHOW if hit_kind == "kill" else HIT_SHOW), 0.0, 1.0)
		draw_prims(ci, hit_cue(hit_kind, c), Color(CUE_COLORS[hit_kind], a))
	for wd in wedges:
		var a := clampf(float(wd.t) / WEDGE_FADE, 0.0, 1.0)
		draw_prims(ci, hit_cue("received", c, wedge_screen_dir(wd)), Color(CUE_COLORS.received, a))

func _draw_marker(ci: CanvasItem, mk: Dictionary) -> void:
	var font := _font()
	var col: Color = mk.spec.color
	var pos: Vector2 = mk.pos
	var box: Rect2 = mk.rect
	var y := box.position.y
	for i in 2:
		var px: int = MARKER_PX[i]
		var s: String = mk.lines[i]
		var at := Vector2(pos.x - font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, px).x * 0.5, y + font.get_ascent(px))
		ci.draw_string_outline(font, at, s, HORIZONTAL_ALIGNMENT_LEFT, -1, px, 4, Color(0, 0, 0, 0.85))
		ci.draw_string(font, at, s, HORIZONTAL_ALIGNMENT_LEFT, -1, px, Color(1, 1, 1, 0.92) if i == 0 else col)
		y += font.get_height(px)
	draw_prims(ci, marker_shapes(mk.spec.shape, pos), col)

func draw_glyph(ci: Control, team: int) -> void:
	var pr := _prims()
	pr.fills.append(team_glyph(team, ci.size * 0.5, minf(ci.size.x, ci.size.y) * 0.5 - 1.5))
	draw_prims(ci, pr, T.TEAM_COLORS[team].lightened(0.3))

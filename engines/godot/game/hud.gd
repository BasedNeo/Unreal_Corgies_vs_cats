extends CanvasLayer
## HUD (lane G-GAME): team scores racing to 60, the match timer, the slab state, the crosshair with hit markers, a
## slab direction marker, hit points and ammo, the takedown feed, the respawn countdown, the controls hint, the
## PLACEHOLDER tag and the winner screen with the rematch prompt. Reads `game` (match.gd) every frame.

const T := preload("res://game/tuning.gd")

var game: Node
var _score: Array[Label] = []
var _fill: Array[ColorRect] = []
var _timer: Label
var _slab: Label
var _hp: Label
var _hp_fill: ColorRect
var _ammo: Label
var _center: Label
var _feed: Label
var _hint: Label
var _winner: Control
var _win_title: Label
var _win_sub: Label
var _flash: ColorRect
var _cross: Control
var hit_t := 0.0
var hit_kill := false
var hit_head := false
var _dmg_t := 0.0
var _hooked: Node = null
var _hint_t := 14.0

class Overlay extends Control:
	var hud: Node
	func _draw() -> void:
		var g: Node = hud.game
		if g == null:
			return
		var cam := get_viewport().get_camera_3d()
		# slab direction marker
		var p: Vector3 = g.slab.center + Vector3(0, 1.5, 0) if g.slab != null else Vector3.ZERO
		if cam != null and g.slab != null and g.player != null and cam.global_position.distance_to(p) > 1.0:
			var sz := size
			var col: Color = hud.slab_color()
			var behind := cam.is_position_behind(p)
			var sp := cam.unproject_position(p)
			if behind:
				sp = sz - sp
				sp.y = sz.y - 40.0
			var margin := 36.0
			var clamped := Vector2(clampf(sp.x, margin, sz.x - margin), clampf(sp.y, margin + 70.0, sz.y - margin))
			var r := 9.0
			draw_colored_polygon(PackedVector2Array([clamped + Vector2(0, -r), clamped + Vector2(r, 0), clamped + Vector2(0, r),
				clamped + Vector2(-r, 0)]), col)
			draw_string(get_theme_default_font(), clamped + Vector2(-17, -14), "SLAB", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)
		if g.player == null or not g.player.alive:
			return
		var c := size * 0.5
		var spread: float = g.player.current_spread() + g.player.rifle.bloom
		var gap := 5.0 + spread * 420.0
		var w := Color(1, 1, 1, 0.92)
		for d in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
			draw_line(c + d * gap, c + d * (gap + 9.0), Color(0, 0, 0, 0.6), 4.0)
			draw_line(c + d * gap, c + d * (gap + 9.0), w, 2.0)
		draw_circle(c, 1.6, w)
		if hud.hit_t > 0.0:
			var a: float = clampf(hud.hit_t / 0.18, 0.0, 1.0)
			var hc := Color(1.0, 0.25, 0.2, a) if hud.hit_kill else (Color(1.0, 0.85, 0.2, a) if hud.hit_head else Color(1, 1, 1, a))
			var k := 14.0 if hud.hit_kill else 10.0
			for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
				draw_line(c + d * 5.0, c + d * k, hc, 2.5)

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
	# bottom left: hit points; bottom right: ammo
	var hpbg := ColorRect.new()
	hpbg.color = Color(0, 0, 0, 0.55)
	hpbg.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	hpbg.position = Vector2(24, -46)
	hpbg.size = Vector2(240, 14)
	root.add_child(hpbg)
	_hp_fill = ColorRect.new()
	_hp_fill.color = Color(0.55, 0.9, 0.45)
	_hp_fill.size = Vector2(240, 14)
	hpbg.add_child(_hp_fill)
	_hp = _label("120", 22, Color.WHITE)
	_hp.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	_hp.position = Vector2(24, -80)
	root.add_child(_hp)
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

func slab_color() -> Color:
	var st: Dictionary = game.slab_state
	if st.contested:
		return Color(1.0, 0.65, 0.2)
	if int(st.holder) >= 0:
		return T.TEAM_COLORS[int(st.holder)].lightened(0.35)
	return Color(0.9, 0.92, 0.95)

func _hook_player() -> void:
	var p: Node = game.player
	if p == _hooked:
		return
	_hooked = p
	if p != null:
		p.hit_confirmed.connect(func(res): hit_t = 0.18; hit_kill = bool(res.get("kill", false)); hit_head = bool(res.head))
		p.damaged.connect(func(_a, _f): _dmg_t = 0.35)

func _process(delta: float) -> void:
	if game == null:
		return
	_hook_player()
	hit_t = maxf(0.0, hit_t - delta)
	_dmg_t = maxf(0.0, _dmg_t - delta)
	_hint_t -= delta
	_flash.color.a = _dmg_t * 0.5
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
	var lines := PackedStringArray()
	for f in game.feed:
		lines.append(f.text)
	_feed.text = "\n".join(lines)
	var p: Node = game.player
	_hp.visible = p != null
	_hp_fill.get_parent().visible = p != null
	_ammo.visible = p != null
	_hint.visible = p != null and _hint_t > 0.0 and game.playing()
	_center.text = ""
	if p != null:
		_hp.text = "%d" % int(ceil(p.hp))
		_hp_fill.size.x = 240.0 * clampf(p.hp / float(T.MAX_HP), 0.0, 1.0)
		_hp_fill.color = Color(0.55, 0.9, 0.45) if p.hp > 40.0 else Color(1.0, 0.4, 0.3)
		_ammo.text = "RELOADING" if p.rifle.reloading() else "%d / %d" % [p.rifle.ammo, int(T.RIFLE.mag)]
		if not p.alive and game.playing():
			_center.text = "TAKEN DOWN  ·  back in %.1f" % game.respawn_left(p)
		elif Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not p.using_pad and DisplayServer.get_name() != "headless" \
				and game.playing():
			_center.text = "Click to play"
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
	_cross.queue_redraw()

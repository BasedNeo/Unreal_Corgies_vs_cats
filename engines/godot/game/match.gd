extends Node
## Game (lane G-GAME): Corgi Company vs Cat Cadre on The Lot. Hold the slab alone to score 1 point per second;
## contested, nobody scores. First to 60, or the most points at 3:00 (tied: overtime until someone leads, 60 s max,
## then a draw). Down pets respawn at their team spawn after 3 s. Winner screen, then R / Enter / Start = rematch.
## Talks to the world only through its contract (README): `built`, spawn_points(team), slab(), nav_region().
##
## User args (after `--`): --2v2 (you + a Corgi bot vs two Cat bots), --bots-only (a bot takes your place),
## --debug (PLACEHOLDER Label3D over each pet), --demo (the first match is played beside the slab: everyone starts
## and respawns next to it, you 2 m off its edge; proof shots), --lineup M (READ check: you stand M m from the slab
## centre on open ground, the play camera aimed 1.5 m over the bots; a Corgi bot and a Cat bot stand still on it
## side by side, facing you; --lineup-side stands them side on, in profile, a body length apart), --perf N (print
## the physics tick cost after N s and quit).

const T := preload("res://game/tuning.gd")
const Player := preload("res://game/player.gd")
const Bot := preload("res://game/bot.gd")
const Slab := preload("res://game/slab.gd")
const Hud := preload("res://game/hud.gd")

signal match_started
signal match_over(winner: int)
signal pet_down(pet: Node, killer: Node)
## A slab point for `team` (step_score: one per full second held alone). W13 A-HOOK: game/sfx.gd ticks on it.
signal slab_point(team: int)

enum { WAITING, PLAYING, OVER }

## Set before the node enters the tree (tests), or from the user args in _ready.
var opts := {"human": true, "allies": 0, "enemies": 1, "think": true, "debug": false, "demo": false, "lineup": 0.0,
	"lineup_side": false}
var state := WAITING
var world: Node = null
var look: Node = null
var pets: Array = []
var player: Node = null
var slab: Node3D = null
var hud: CanvasLayer = null
var score := [0, 0]
var time_left: float = T.MATCH_TIME
var overtime := false
var overtime_t := 0.0
var winner := -1
var elapsed := 0.0
var hold_acc := 0.0
var slab_state := {"holder": -1, "contested": false, "counts": [0, 0]}
var spawns := [[], []]
var feed: Array = []
var _respawns: Array = []
var _hold_team := -1
var _built := false
var _spectator: Camera3D = null
var _spec_t := 0.0
var _ground_y := 0.0
var _perf_secs := 0.0
var _perf: PackedFloat32Array = []
var _tick: PackedFloat32Array = []
var _perf_hooks: Array = []

## Perf probe: a hook that runs first and one that runs last in every physics tick; their gap is the scripted tick
## cost (every _physics_process in the tree: world, look, game). TIME_PHYSICS_PROCESS is Godot's per-second maximum
## of the whole physics frame (scripts + physics server), so both are reported.
class TickHook extends Node:
	var game: Node
	var first := true
	var t0 := 0
	func _physics_process(_d: float) -> void:
		if first:
			game._tick_t0 = Time.get_ticks_usec()
		elif game._tick_t0 > 0 and game.elapsed > 2.0:
			game._tick.append((Time.get_ticks_usec() - game._tick_t0) / 1000.0)
var _tick_t0 := 0
var _demo_done := false
## --demo: true while the first match runs, so its respawns come back beside the slab as well (W13: at HEAD the Cat
## bot downed the human 2-3 s in and the respawn sent them to the team spawn, 120-140 m away).
var _demo_live := false
## --lineup: where the human stands (set by _place_lineup).
var lineup_spot := Vector3.ZERO

func _enter_tree() -> void:
	# Connect before World._ready runs (enter_tree reaches every node before any _ready), so a world that emits
	# `built` synchronously in its _ready is not missed.
	world = get_parent().get_node_or_null("World") if get_parent() != null else null
	if world != null and world.has_signal("built") and not world.built.is_connected(_on_built):
		world.built.connect(_on_built)

func _ready() -> void:
	_parse_args()
	look = get_parent().get_node_or_null("Look") if get_parent() != null else null
	if world == null or not world.has_signal("built") or world.get("is_built") == true:
		_on_built()

func _parse_args() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		match a[i]:
			"--2v2":
				opts.allies = 1
				opts.enemies = 2
			"--bots-only":
				opts.human = false
			"--debug":
				opts.debug = true
			"--demo":
				opts.demo = true
			"--lineup":
				opts.lineup = float(a[i + 1]) if i + 1 < a.size() else 30.0
			"--lineup-side":
				opts.lineup_side = true
			"--perf":
				_perf_secs = float(a[i + 1]) if i + 1 < a.size() else 20.0
				for first in [true, false]:
					var h := TickHook.new()
					h.game = self
					h.first = first
					h.process_physics_priority = -1000000 if first else 1000000
					add_child(h)

func _on_built() -> void:
	if _built:
		return
	_built = true
	_begin.call_deferred()

func playing() -> bool:
	return state == PLAYING

func over() -> bool:
	return state == OVER

## The world's nav map serves paths a few physics frames after `built` (nav_ready() in world.gd); a world without it
## (the skeleton + the game's fallback region) counts as ready.
func nav_ready() -> bool:
	return world == null or not world.has_method("nav_ready") or world.nav_ready()

func _begin() -> void:
	var sd: Dictionary = {"center": Vector3.ZERO, "size": Vector2(8, 8)}
	if world != null and world.has_method("slab"):
		sd = world.slab()
	var c: Vector3 = sd.center
	_ground_y = c.y
	_ensure_ground(c)
	_ensure_nav(c)
	slab = Slab.new()
	add_child(slab)
	slab.setup(c, sd.size)
	_pick_spawns(c)
	hud = Hud.new()
	hud.game = self
	add_child(hud)
	if float(opts.lineup) > 0.0:  # you, a Corgi bot and a Cat bot; the bots stand still and hold fire
		opts.human = true
		opts.allies = 1
		opts.enemies = 1
		opts.think = false
		opts.demo = false
	_spawn_pets()
	start_match()

# --- setup -------------------------------------------------------------------------------------------------------

func _ground_rect(c: Vector3) -> Rect2:
	for g in get_tree().get_nodes_in_group("ground"):
		if g is MeshInstance3D and g.mesh != null:
			var ab: AABB = g.global_transform * g.mesh.get_aabb()
			return Rect2(ab.position.x, ab.position.z, ab.size.x, ab.size.z)
	return Rect2(c.x - 40.0, c.z - 40.0, 80.0, 80.0)

## The skeleton world has a visual ground but no collider: add one so the match is playable before G-WORLD lands.
func _ensure_ground(c: Vector3) -> void:
	if world == null or not get_tree().get_nodes_in_group("world_static").is_empty():
		return
	if not world.find_children("*", "CollisionObject3D", true, false).is_empty():
		return
	var r := _ground_rect(c)
	var body := StaticBody3D.new()
	body.name = "FallbackGround"
	body.collision_layer = T.L_WORLD
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(r.size.x, 2.0, r.size.y)
	cs.shape = box
	body.add_child(cs)
	add_child(body)
	body.global_position = Vector3(r.get_center().x, c.y - 1.0, r.get_center().y)

## Bots path on the world's baked region. Without one (the skeleton), a flat region over the ground.
func _ensure_nav(c: Vector3) -> void:
	if world != null and world.has_method("nav_region") and world.nav_region() is NavigationRegion3D:
		return
	var r := _ground_rect(c)
	var nm := NavigationMesh.new()
	var y := c.y
	nm.vertices = PackedVector3Array([Vector3(r.position.x, y, r.position.y), Vector3(r.end.x, y, r.position.y),
		Vector3(r.end.x, y, r.end.y), Vector3(r.position.x, y, r.end.y)])
	nm.add_polygon(PackedInt32Array([0, 1, 2, 3]))
	var reg := NavigationRegion3D.new()
	reg.name = "FallbackNav"
	reg.navigation_mesh = nm
	add_child(reg)

func _pick_spawns(c: Vector3) -> void:
	for t in 2:
		var pts: Array = []
		if world != null and world.has_method("spawn_points"):
			for p in world.spawn_points(t):
				pts.append(p)
		spawns[t] = pts
	var bad: bool = spawns[0].is_empty() or spawns[1].is_empty()
	if not bad:
		for a in spawns[0]:
			for b in spawns[1]:
				if (a as Vector3).distance_to(b) < 8.0:
					bad = true
	if bad:  # the skeleton gives both teams one shared point: fall back to two ends of the slab's long axis
		var r := _ground_rect(c)
		var reach := minf(22.0, minf(r.size.x, r.size.y) * 0.4)
		spawns[0] = [c + Vector3(-2.5, 0.5, reach), c + Vector3(0, 0.5, reach + 1.5), c + Vector3(2.5, 0.5, reach)]
		spawns[1] = [c + Vector3(2.5, 0.5, -reach), c + Vector3(0, 0.5, -reach - 1.5), c + Vector3(-2.5, 0.5, -reach)]

func _spawn_pets() -> void:
	for p in pets:
		p.queue_free()
	pets.clear()
	player = null
	var n0 := 1 + int(opts.allies)
	for i in n0:
		if i == 0 and opts.human:
			player = _add_pet(Player, 0, "You")
		else:
			_add_pet(Bot, 0, "Corgi Bot %d" % (i + (0 if opts.human else 1)))
	for i in int(opts.enemies):
		_add_pet(Bot, 1, "Cat Bot %d" % (i + 1))
	if player == null:
		_spectator = Camera3D.new()
		_spectator.fov = 60.0
		add_child(_spectator)
		_spectator.current = true
	elif _spectator != null:
		_spectator.queue_free()
		_spectator = null

func _add_pet(script: Script, team: int, nm: String) -> Node:
	var p = script.new()
	p.configure(team, team, nm, look)
	p.name = nm.replace(" ", "")
	p.game = self
	p.debug_label = opts.debug
	if p.get("think") != null:
		p.think = opts.think
	add_child(p)
	p.died.connect(_on_died)
	pets.append(p)
	return p

# --- match flow --------------------------------------------------------------------------------------------------

func start_match() -> void:
	score = [0, 0]
	time_left = T.MATCH_TIME
	overtime = false
	overtime_t = 0.0
	winner = -1
	elapsed = 0.0
	hold_acc = 0.0
	_hold_team = -1
	feed.clear()
	_respawns.clear()
	_demo_live = opts.demo and not _demo_done
	_demo_done = _demo_done or opts.demo
	var used := [0, 0]
	var slots := [start_slots(0), start_slots(1)]
	for p in pets:
		var list: Array = slots[p.team]
		var sp: Vector3 = list[used[p.team] % list.size()]
		sp += Vector3(1.2 * float(used[p.team] / list.size()), 0, 0)
		used[p.team] += 1
		p.set_meta("slot", used[p.team])
		if _demo_live:
			sp = _demo_spot(p, used[p.team])
		p.respawn(sp, _yaw_to(sp, slab.center))
	if float(opts.lineup) > 0.0:
		_place_lineup(float(opts.lineup))
	state = PLAYING
	match_started.emit()

## Match-start slots (W13 G-BOT): equal time, not equal distance. The Corgis' slots run from their farthest spawn (slot 0,
## the human's: spawn 0, with the straight walk up the slab path) to the nearest. Every other team's slot k is the
## unused spawn whose straight-line sprint time to the slab (distance / the species' sprint, tuning.gd MOVE) is closest
## to the Corgis' slot k. On The Lot that is 14.95 s for the Corgis' slot 0 (143.5 m at 9.6 m/s) and 15.05 s for the
## Cats' (132.4 m at 8.8 m/s); 14.64 s and 14.60 s for slot 1. In the data's own order the Corgis started 143.5 m out
## and the Cats 119.0 m (the Cat side was first on the slab in 199 of 200 bots-only matches); at equal distance the
## faster-sprinting Corgis were first in 100 of 100 (docs/handoff/G-BOT.md). `spawns` itself keeps the data order
## (--demo, --lineup and respawns read it).
func start_slots(team: int) -> Array:
	var ref: Array = spawns[0].duplicate()
	ref.sort_custom(func(a: Vector3, b: Vector3) -> bool: return _sprint_time(a, 0) > _sprint_time(b, 0))
	if team == 0:
		return ref
	var left: Array = spawns[team].duplicate()
	var out: Array = []
	for r in ref:
		if left.is_empty():
			break
		var want := _sprint_time(r, 0)
		var best := 0
		for i in left.size():
			if absf(_sprint_time(left[i], team) - want) < absf(_sprint_time(left[best], team) - want):
				best = i
		out.append(left[best])
		left.remove_at(best)
	out.append_array(left)
	return out

## Straight-line sprint time from `sp` to the slab centre for `team`'s species (team = species in this game).
func _sprint_time(sp: Vector3, team: int) -> float:
	var c: Vector3 = slab.center
	return Vector2(sp.x - c.x, sp.z - c.z).length() / float(T.MOVE[team].sprint)

func rematch() -> void:
	start_match()

func end_match(w: int) -> void:
	state = OVER
	winner = w
	match_over.emit(w)

func _physics_process(delta: float) -> void:
	if state != PLAYING:
		return
	elapsed += delta
	for r in _respawns.duplicate():
		r[1] -= delta
		if r[1] <= 0.0:
			_respawns.erase(r)
			var sp := _demo_spot(r[0], int(r[0].get_meta("slot", 1))) if _demo_live else best_spawn(r[0].team)
			r[0].respawn(sp, _yaw_to(sp, slab.center))
	for p in pets:
		if p.alive and p.global_position.y < _ground_y - 40.0:
			p.die(null)
	step_score(delta)
	if overtime:
		overtime_t += delta
	else:
		time_left = maxf(0.0, time_left - delta)
	_check_end()
	if _perf_secs > 0.0 and elapsed > 2.0:
		_perf.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
		if elapsed >= _perf_secs + 2.0:
			_report_perf()

## Slab scoring: alone on the slab = 1 point per full second held; contested or empty = nothing.
func step_score(delta: float) -> void:
	slab_state = slab.evaluate(pets)
	var holder: int = slab_state.holder
	if holder != _hold_team:
		_hold_team = holder
		hold_acc = 0.0
	if holder >= 0 and state == PLAYING:
		hold_acc += delta
		while hold_acc >= 1.0 - 1e-6:
			hold_acc -= 1.0
			score[holder] += 1
			slab_point.emit(holder)
	slab.show_state(slab_state, delta)

func _check_end() -> void:
	for t in 2:
		if score[t] >= T.WIN_SCORE:
			end_match(t)
			return
	if not overtime and time_left <= 0.0:
		if score[0] != score[1]:
			end_match(0 if score[0] > score[1] else 1)
		else:
			overtime = true
	elif overtime:
		if score[0] != score[1]:
			end_match(0 if score[0] > score[1] else 1)
		elif overtime_t >= T.OVERTIME_MAX:
			end_match(-1)

func _process(delta: float) -> void:
	if state == OVER and Input.is_action_just_pressed("rematch"):
		rematch()
	if state != WAITING and Input.is_action_just_pressed("toggle_mode"):
		var duo := int(opts.enemies) < 2
		opts.allies = 1 if duo else 0
		opts.enemies = 2 if duo else 1
		_spawn_pets()
		start_match()
	for f in feed:
		f.t -= delta
	feed = feed.filter(func(f): return f.t > 0.0)
	if _spectator != null and slab != null:
		_spec_t += delta * 0.12
		var c: Vector3 = slab.center
		_spectator.look_at_from_position(c + Vector3(sin(_spec_t) * 24.0, 13.0, cos(_spec_t) * 24.0), c)

func on_shot(shooter: Node) -> void:
	for p in pets:
		if p.team != shooter.team and p.alive and p.has_method("hear") \
				and p.global_position.distance_to(shooter.global_position) < float(T.RIFLE.noise):
			p.hear(shooter)

func _on_died(pet: Node, killer: Node) -> void:
	_respawns.append([pet, T.RESPAWN_TIME])
	var who: String = killer.display_name if killer != null else "The Lot"
	feed.append({"text": "%s  >  %s" % [who, pet.display_name], "team": killer.team if killer != null else -1, "t": 5.0})
	if feed.size() > 4:
		feed.pop_front()
	pet_down.emit(pet, killer)

func respawn_left(pet: Node) -> float:
	for r in _respawns:
		if r[0] == pet:
			return r[1]
	return 0.0

## The team spawn farthest from the nearest living enemy (no spawn camping), with a small lateral jitter.
func best_spawn(team: int) -> Vector3:
	var best: Vector3 = spawns[team][0]
	var best_d := -1.0
	for sp in spawns[team]:
		var d := INF
		for p in pets:
			if p.team != team and p.alive:
				d = minf(d, (sp as Vector3).distance_to(p.global_position))
		if d > best_d:
			best_d = d
			best = sp
	return best + Vector3(randf_range(-0.8, 0.8), 0.0, randf_range(-0.8, 0.8))

## --demo: a spot on the pet's own side of the slab, on the ground found by a ray: the human 2 m off the slab's edge
## (facing across it), bots 11-15 m from its centre and spread sideways.
func _demo_spot(p: Node, i: int) -> Vector3:
	var c: Vector3 = slab.center
	var home: Vector3 = spawns[p.team][0]
	var d := Vector3(home.x - c.x, 0.0, home.z - c.z).normalized()
	var side := Vector3(-d.z, 0.0, d.x)
	var xz := c + d * (9.0 + 2.0 * i) + side * (2.5 * i - 1.0)
	if p == player:
		var edge := minf(slab.size.x * 0.5 / maxf(absf(d.x), 1e-3), slab.size.y * 0.5 / maxf(absf(d.z), 1e-3))
		xz = c + d * (edge + 2.0)
	var hit := _ground_hit(xz)
	return (hit.position if not hit.is_empty() else xz) + Vector3(0, 0.3, 0)

func _ground_hit(xz: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(Vector3(xz.x, xz.y + 30.0, xz.z), Vector3(xz.x, xz.y - 30.0, xz.z), T.L_WORLD)
	return get_viewport().get_world_3d().direct_space_state.intersect_ray(q)

## --lineup M: the human M m from the slab centre on open, level ground with a clear view of the slab (the first such
## bearing, searched outwards from the Corgi side in 15 degree steps); the play camera aims LINEUP_AIM_LIFT m over the
## bots' chests, so the crosshair and the SLAB marker sit above them, not on them. The Corgi bot and the Cat bot stand
## on the slab across the line of sight: 1.8 m apart facing the human, or with --lineup-side side on (both facing
## the same way along the row, in profile) a body length apart. The bots do not think: they stand still and hold fire.
const LINEUP_AIM_LIFT := 1.5
## Bot centres from the slab centre, along the row: facing the human / side on (a body length, about 1.2 m, apart).
const LINEUP_OFFSET := [0.9, 1.4]

func _place_lineup(dist: float) -> void:
	var side_on := bool(opts.get("lineup_side", false))
	var off: float = LINEUP_OFFSET[1 if side_on else 0]
	var c: Vector3 = slab.center
	var home: Vector3 = spawns[0][0]
	var base := atan2(home.x - c.x, home.z - c.z)
	var spot := Vector3.INF
	for k in 24:
		var a := base + deg_to_rad(15.0) * float((k + 1) / 2) * (1.0 if k % 2 == 1 else -1.0)
		var d := Vector3(sin(a), 0.0, cos(a))
		var hit := _ground_hit(c + d * dist)
		if hit.is_empty() or absf(hit.position.y - c.y) > 1.0 or hit.normal.y < 0.94:
			continue  # in the ditch, on a heap or a prop, or on a bank
		if _lineup_clear(hit.position, c, d, off):
			spot = hit.position
			break
	if spot == Vector3.INF:  # nothing clear at that range: stand on the Corgi side anyway
		var d0 := Vector3(sin(base), 0.0, cos(base))
		var h0 := _ground_hit(c + d0 * dist)
		spot = h0.position if not h0.is_empty() else c + d0 * dist
	lineup_spot = spot
	var view := Vector3(c.x - spot.x, 0.0, c.z - spot.z).normalized()
	var across := Vector3(-view.z, 0.0, view.x)
	var bots := pets.filter(func(p): return p != player)
	for p in pets:
		if p == player:
			p.respawn(spot + Vector3(0, 0.05, 0), _yaw_to(spot, c))
			# aim the play camera (boom pivot about 1.4 m over the feet) LINEUP_AIM_LIFT m over the bots' chests
			p.cam_pitch = atan2(c.y + 0.6 + LINEUP_AIM_LIFT - (spot.y + 1.4), Vector2(c.x - spot.x, c.z - spot.z).length())
		else:
			var at: Vector3 = c + across * (off if p.team == 0 else -off)
			var g := _ground_hit(at)
			var pos: Vector3 = (g.position if not g.is_empty() else at) + Vector3(0, 0.05, 0)
			p.respawn(pos, _yaw_to(pos, pos + across) if side_on else _yaw_to(pos, spot))
	if bots.size() != 2:
		push_warning("--lineup expects one Corgi bot and one Cat bot, got %d bots" % bots.size())

## Open ground around the spot (nothing within 1 m above knee height), room for the camera boom (3.2 m back, 0.72 m
## to the right, player.gd), and a clear line from there to the feet and the heads of both bots on the slab.
func _lineup_clear(spot: Vector3, c: Vector3, d: Vector3, off: float) -> bool:
	var space := get_viewport().get_world_3d().direct_space_state
	var sq := PhysicsShapeQueryParameters3D.new()
	var ball := SphereShape3D.new()
	ball.radius = 1.0
	sq.shape = ball
	sq.transform = Transform3D(Basis(), spot + Vector3(0, 1.4, 0))
	sq.collision_mask = T.L_WORLD
	if not space.intersect_shape(sq, 1).is_empty():
		return false
	var pivot := spot + Vector3(0, 1.45, 0)
	var cam := pivot + Vector3(d.z, 0.0, -d.x) * 0.72 + d * 3.4
	var across := Vector3(-d.z, 0.0, d.x)
	var rays := [[pivot, cam + Vector3(0, 0.3, 0)]]
	for side in [-off - 0.8, -off, off, off + 0.8]:  # each bot's centre and its far end
		for h in [0.15, 1.1]:
			rays.append([cam, c + across * side + Vector3(0, h, 0)])
	for r in rays:
		if not space.intersect_ray(PhysicsRayQueryParameters3D.create(r[0], r[1], T.L_WORLD)).is_empty():
			return false
	return true

static func _yaw_to(from: Vector3, to: Vector3) -> float:
	var d := to - from
	return atan2(-d.x, -d.z)

func _report_perf() -> void:
	var s := _perf.duplicate()
	s.sort()
	var sum := 0.0
	for v in s:
		sum += v
	var n := s.size()
	print("PERF TIME_PHYSICS_PROCESS (Godot: worst physics frame per second) over %d ticks, %d pets: avg %.3f ms · p95 %.3f ms · max %.3f ms" % [
		n, pets.size(), sum / maxf(1.0, n), s[int(n * 0.95)] if n > 0 else 0.0, s[n - 1] if n > 0 else 0.0])
	var k := _tick.duplicate()
	k.sort()
	var ks := 0.0
	for v in k:
		ks += v
	var kn := k.size()
	if kn > 0:
		print("PERF scripted physics tick (all _physics_process) over %d ticks: avg %.3f ms · median %.3f ms · p95 %.3f ms · max %.3f ms" % [
			kn, ks / kn, k[kn / 2], k[int(kn * 0.95)], k[kn - 1]])
	print("PERF score %d-%d after %.0f s" % [score[0], score[1], elapsed])
	_perf_secs = 0.0
	get_tree().quit(0)

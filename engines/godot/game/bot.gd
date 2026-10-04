extends "res://game/pet.gd"
## A bot (lane G-GAME): sprints along a NavigationAgent3D path to the slab and holds it. It sees enemies in a 150
## degree cone (or hears them fire within the rifle's noise range), needs line of sight, waits a reaction delay, turns
## its aim at a limited rate and fires bursts of the same rifle with extra spread. Fair by design: no wallhacks, no
## instant snap, no perfect aim. Thinks at 10 Hz (staggered) so the tick stays cheap.

const THINK_DT := 0.1
const VIEW_DIST := 60.0
const VIEW_COS := 0.26  # cos(75 deg): a 150 degree cone
const TURN_RATE := 5.0  # rad/s aim tracking
const AIM_ERROR := 0.035  # rad (~2 deg) on top of the rifle's own spread
const REACT := Vector2(0.4, 0.7)  # seconds before the first shot at a newly seen target
const FIRE_CONE := 0.12  # rad: fire only when the aim is this close to the target
## Travel gait (W13 G-BOT): a bot sprints, as a player does with Shift and as the web bot does (src/sim/ai/brain.ts:
## sprint while more than 12 m of path is left), when it is off the slab, nobody is in sight or heard, and its goal is
## more than SPRINT_MIN m away; otherwise it runs. The species trade speed (tuning.gd MOVE, classes.ts BASE_MOVE): the
## Cat runs faster (6.6 vs 6.4 m/s), the Corgi sprints faster (9.6 vs 8.8). A bot that only ran gave every Cat the
## faster trip from each respawn (1.5-1.8 s over about 140 m), and in 2v2 the faster side's respawns rejoin a fight at
## the slab first: the Cat Cadre won 38 of 60 2v2 bots-only matches (docs/handoff/G-BOT.md).
const SPRINT_MIN := 12.0
## Jump when the next path corner is more than this above the feet (and within 2.5 m). Equal to pet.gd STEP_HEIGHT:
## anything lower is taken in stride by the step-up.
const LEDGE_JUMP := 0.45
## Holding and contesting (W14 G-BOT CONTEST): only a pet inside the score volume (slab.gd contains(): the 8 x 8 m
## square and its y window) holds or contests. On the slab a bot stands and strafes at least SLAB_MARGIN m inside every
## edge: its wish may not carry it past that inner square (it looks EDGE_LOOK m ahead: 1.2 m since W15, was 0.8, for
## more room under tests/test_bot_contest.gd's 5 % edge-band cap; docs/qa/w15/bot-roles.md), and from outside it the
## wish turns back in. Within CONTEST_ZONE m of the square a bot with an enemy in sight keeps stepping in instead of
## backing off to the rifle's minimum range, which left it circling a holder at 7 m and clipping the corners (W13 READ).
const SLAB_MARGIN := 1.0
const EDGE_LOOK := 1.2
const CONTEST_ZONE := 6.0
## 2v2 roles (W15 G-BOT ROLES). When a team has two bots, the one in the even start slot (match.gd sets the pet meta
## "slot" before each start) APPROACHES and the other HOLDS; a team's single bot (1v1, or your ally in 2v2) holds.
## - HOLD: as before, sprint to the slab and hold it.
## - APPROACH: no class, no other weapon; only where it goes. It takes post PUSH_DIST m out from the slab's centre on
##   the enemy's way in (the nav path from the enemy's first respawn point to the slab), faces down that path and
##   fights whoever comes along it. It steps onto the slab, and stays at least STEP_ON_MIN s, when no teammate is
##   alive to hold it or an enemy stands on it (a contester). Measured (docs/qa/w15/bot-roles.md, "Roles are
##   nominal"): it is at its post under 1 % of its alive time (0.8 s / 0.1 s per match; the checker measured 0-2.4 %),
##   so in play the roles are nominal (Sprint C item 8: NOT MET). The cause is a trap, not the step-on rule: _steer()
##   counts any bot inside the slab as on it, and _hold_inside() then clamps its wish to the inner margin, so an
##   APPROACH bot whose post lies past the slab is held on the slab and never walks off to its post. Fixing the trap
##   is a separate card with its own measurement.
enum { ROLE_HOLD, ROLE_APPROACH }
const PUSH_DIST := 16.0
const STEP_ON_MIN := 3.0

var think := true  # false = a frozen dummy (tests)
var ledge_jump := LEDGE_JUMP  # tests/balance.gd --jump-up overrides it for an A/B
var jumps := 0  # jumps asked for (ledge or unstick), for tests/balance.gd
var agent: NavigationAgent3D
var target: Node = null
var target_visible := false
var seen := 0.0
var lost := 0.0
var react := 0.4
var aim_dir := Vector3.FORWARD
var goal := Vector3.ZERO
var rng := RandomNumberGenerator.new()
var _think_t := 0.0
var _burst := 6
var _pause := 0.0
var _strafe := 1.0
var _strafe_t := 0.0
var _stuck_t := 0.0
var _want_jump := false
var _heard: Node = null
var _heard_t := 0.0
var _nav_ok := false
var role := ROLE_HOLD
## APPROACH: the post on the enemy's way in, and the way it faces there (INF until the nav map serves the path).
var push_point := Vector3.INF
var push_look := Vector3.ZERO
var _step_on_t := 0.0  # APPROACH: seconds it keeps stepping on after the reason has gone
var _stepping_on := false

func _ready() -> void:
	super._ready()
	rng.seed = hash(display_name) ^ (team * 7919)
	rifle.rng.seed = rng.randi()
	agent = NavigationAgent3D.new()
	agent.radius = m.radius
	agent.height = T.height(species)
	agent.path_desired_distance = 0.7
	agent.target_desired_distance = 0.9
	agent.avoidance_enabled = false
	add_child(agent)
	_think_t = rng.randf() * THINK_DT
	react = rng.randf_range(REACT.x, REACT.y)

## A new life, and every start and rematch (match.gd start_match respawns every pet): the role from the slot, and every
## piece of think state back to its start value (target, timers, the step-on latch, the post and the goal and path).
func respawn(pos: Vector3, face_yaw: float) -> void:
	super.respawn(pos, face_yaw)
	aim_dir = Vector3(-sin(face_yaw), 0.0, -cos(face_yaw))
	target = null
	target_visible = false
	seen = 0.0
	lost = 0.0
	_heard = null
	_heard_t = 0.0
	_stuck_t = 0.0
	_pause = 0.0
	_burst = 6
	_strafe = 1.0
	_strafe_t = 0.0
	_want_jump = false
	role = _role_from_slot()
	push_point = Vector3.INF
	push_look = Vector3.ZERO
	_step_on_t = 0.0
	_stepping_on = role != ROLE_APPROACH
	_pick_goal()

## APPROACH for the bot in an even start slot of a team that has two or more bots, else HOLD.
func _role_from_slot() -> int:
	if game == null:
		return ROLE_HOLD
	var bots: int = game.pets.filter(func(p): return p.team == team and p.get("think") != null).size()
	if bots < 2:
		return ROLE_HOLD
	return ROLE_APPROACH if int(get_meta("slot", 1)) % 2 == 0 else ROLE_HOLD

func hear(src: Node) -> void:
	_heard = src
	_heard_t = 1.2

func _physics_process(delta: float) -> void:
	tick_common(delta)
	if not alive:
		return
	if game == null or not game.playing() or not think:
		move_pet(Vector3.ZERO, 0.0, false, false, delta)
		return
	_heard_t -= delta
	_think_t -= delta
	if _think_t <= 0.0:
		_think_t += THINK_DT
		_think(THINK_DT)
	# aim tracking at a limited turn rate
	var want := aim_dir
	if target != null and target.alive and target_visible:
		want = (target.chest() - eye()).normalized()
	elif _heard_t > 0.0 and _heard != null and _heard.alive:
		want = (_heard.chest() - eye()).normalized()
	else:
		var hv := Vector3(velocity.x, 0.0, velocity.z)
		if hv.length() > 0.8:
			want = hv.normalized()
		elif _pushing() and push_look != Vector3.ZERO:
			want = push_look  # at the post: watch the enemy's way in
	aim_dir = _turn(aim_dir, want, TURN_RATE * delta)
	set_facing(atan2(-aim_dir.x, -aim_dir.z), asin(clampf(aim_dir.y, -1.0, 1.0)))
	_shoot(delta)
	var wish := _steer(delta)
	if _want_jump:
		jumps += 1
	move_pet(wish, _gait(), _want_jump, _want_jump, delta)
	_want_jump = false
	var hs := Vector2(velocity.x, velocity.z).length()
	var far := Vector2(goal.x - global_position.x, goal.z - global_position.z).length() > 1.5
	far = far and not game.slab.contains(global_position)  # standing still on the slab is holding, not stuck
	_stuck_t = _stuck_t + delta if far and hs < 0.6 else 0.0
	if _stuck_t > 0.6:
		_stuck_t = 0.0
		_want_jump = true
		_pick_goal()

## Run speed at a fight, on the slab or near the goal; the species' sprint on the way there.
func _gait() -> float:
	if (target != null and target_visible and target.alive) or _heard_t > 0.0 or game.slab.contains(global_position):
		return m.run
	return m.sprint if Vector2(goal.x - global_position.x, goal.z - global_position.z).length() > SPRINT_MIN else m.run

func _think(dt: float) -> void:
	if not _nav_ok and game.nav_ready():
		_nav_ok = true
		agent.target_position = goal  # ask again now that the map serves paths
	var best: Node = null
	var best_d := INF
	var fwd := Vector3(aim_dir.x, 0.0, aim_dir.z).normalized()
	for p in game.pets:
		if p.team == team or not p.alive:
			continue
		var to: Vector3 = p.chest() - eye()
		var d := to.length()
		if d > VIEW_DIST:
			continue
		var flat := Vector3(to.x, 0.0, to.z).normalized()
		var in_cone: bool = fwd.dot(flat) >= VIEW_COS or d < 4.0 or (p == _heard and _heard_t > 0.0) or p == target
		if not in_cone or not _los(p):
			continue
		var score := d - (6.0 if p == target else 0.0)  # sticky target
		if score < best_d:
			best_d = score
			best = p
	if best != null:
		if best != target:
			seen = 0.0
			react = rng.randf_range(REACT.x, REACT.y)
		target = best
		target_visible = true
		seen += dt
		lost = 0.0
	else:
		target_visible = false
		lost += dt
		if lost > 0.4:
			seen = 0.0
		if lost > 1.5:
			target = null
	_strafe_t -= dt
	if _strafe_t <= 0.0:
		_strafe = -_strafe if rng.randf() < 0.7 else _strafe
		_strafe_t = rng.randf_range(0.5, 1.3)
	if role == ROLE_APPROACH:
		if push_point == Vector3.INF and _nav_ok:
			_find_post()
			if not _stepping_on:
				_pick_goal()
		var reason: bool = _holder_down() or game.slab_state.counts[1 - team] > 0
		_step_on_t = STEP_ON_MIN if reason else maxf(0.0, _step_on_t - dt)
		var on := _step_on_t > 0.0
		if on != _stepping_on:
			_stepping_on = on
			_pick_goal()
	if _pushing():
		pass  # holding the post
	elif game.slab.contains(global_position):
		if global_position.distance_to(goal) < 1.0:
			_pick_goal()
	elif agent.is_navigation_finished() or not game.slab.contains(goal):
		_pick_goal()

## APPROACH, away from the slab: going to or holding the post.
func _pushing() -> bool:
	return role == ROLE_APPROACH and not _stepping_on

## No other pet of this team is alive to hold the slab.
func _holder_down() -> bool:
	for p in game.pets:
		if p != self and p.team == team and p.alive:
			return false
	return true

## The post: the point PUSH_DIST m (flat) from the slab's centre on the nav path from the enemy's first respawn point
## (match.gd respawn_slots, else its spawns) to the slab, and the way back along that path. Left at INF while the map
## serves no path.
func _find_post() -> void:
	var foe := 1 - team
	var from: Vector3 = Vector3.INF
	var rs = game.get("respawn_slots")
	if rs is Array and rs.size() > foe and not rs[foe].is_empty():
		from = rs[foe][0]
	elif game.spawns.size() > foe and not game.spawns[foe].is_empty():
		from = game.spawns[foe][0]
	if from == Vector3.INF:
		return
	var c: Vector3 = game.slab.center
	var path := NavigationServer3D.map_get_path(agent.get_navigation_map(), from, c, true)
	if path.size() < 2:
		return
	for i in range(path.size() - 1, 0, -1):
		var a := path[i - 1]
		var b := path[i]
		var da := Vector2(a.x - c.x, a.z - c.z).length()
		var db := Vector2(b.x - c.x, b.z - c.z).length()
		if db <= PUSH_DIST and da > PUSH_DIST:
			var k := (PUSH_DIST - db) / maxf(da - db, 1e-3)
			push_point = b.lerp(a, k)
			var away := Vector3(a.x - push_point.x, 0.0, a.z - push_point.z)
			if away.length() < 0.1:
				away = Vector3(push_point.x - c.x, 0.0, push_point.z - c.z)
			push_look = away.normalized()
			return

func _los(p: Node) -> bool:
	var q := PhysicsRayQueryParameters3D.create(eye(), p.chest(), T.L_WORLD)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()

func _shoot(delta: float) -> void:
	if target == null or not target_visible or not target.alive or seen < react:
		return
	if _pause > 0.0:
		_pause -= delta
		return
	var to: Vector3 = target.chest() - eye()
	if aim_dir.angle_to(to) > FIRE_CONE or to.length() > float(T.RIFLE.range):
		return
	var r := T.RIFLE
	var hs := Vector2(velocity.x, velocity.z).length()
	var spread: float = float(r.spread_hip) * (1.0 + (float(r.move_mult) - 1.0) * clampf(hs / float(m.run), 0.0, 1.0))
	var res: Dictionary = rifle.shoot(eye(), aim_dir, spread + AIM_ERROR)
	if not res.is_empty():
		_burst -= 1
		if _burst <= 0:
			_burst = rng.randi_range(5, 9)
			_pause = rng.randf_range(0.25, 0.6)

func _steer(_delta: float) -> Vector3:
	var pos := global_position
	var on_slab: bool = game.slab.contains(pos)
	var dir := Vector3.ZERO
	if on_slab:
		dir = goal - pos
	else:
		# Until the nav map is ready there is no path: head straight for the goal.
		# Follow the path by horizontal distance (the agent's own advance counts height, and a navmesh step the
		# capsule cannot walk up would pin it); jump when the next corner is a ledge above us.
		agent.get_next_path_position()
		var path := agent.get_current_navigation_path()
		var nxt := goal
		for i in range(agent.get_current_navigation_path_index(), path.size()):
			if Vector2(path[i].x - pos.x, path[i].z - pos.z).length() > 0.6:
				nxt = path[i]
				break
		dir = nxt - pos
		if nxt.y - pos.y > ledge_jump and Vector2(dir.x, dir.z).length() < 2.5 and is_on_floor():
			_want_jump = true
	dir.y = 0.0
	dir = dir.normalized() if dir.length() > 0.3 else Vector3.ZERO
	var contest := on_slab or _off_square(pos) <= CONTEST_ZONE
	if target != null and target_visible and target.alive:
		var to: Vector3 = target.global_position - pos
		to.y = 0.0
		var d := to.length()
		var side := Vector3(-to.z, 0.0, to.x).normalized() * _strafe
		var a_min: float = T.RIFLE.ai_range[0]
		if on_slab:
			dir = (dir * 0.7 + side * 0.8).normalized()
		elif contest:  # step in while fighting: strafe less, never back off
			dir = (dir + side * 0.4).normalized()
		else:
			dir = (dir + side * 0.8).normalized()
			if d < a_min:
				dir = (dir - to.normalized() * 0.6).normalized()
	if on_slab:
		dir = _hold_inside(dir, pos)
	return dir

## Horizontal distance from `p` to the slab's square (0 inside it).
func _off_square(p: Vector3) -> float:
	var c: Vector3 = game.slab.center
	var h: Vector2 = game.slab.size * 0.5
	var dx := maxf(0.0, absf(p.x - c.x) - h.x)
	var dz := maxf(0.0, absf(p.z - c.z) - h.y)
	return Vector2(dx, dz).length()

## A wish that keeps the bot SLAB_MARGIN m inside every edge of the slab: per axis, the part that would carry it past
## the inner square within EDGE_LOOK m is cut back to reach it (pointing in when the bot is already past it). A strafe
## the edge stops turns round.
func _hold_inside(dir: Vector3, pos: Vector3) -> Vector3:
	var c: Vector3 = game.slab.center
	var h: Vector2 = game.slab.size * 0.5 - Vector2(SLAB_MARGIN, SLAB_MARGIN)
	var rel := Vector2(pos.x - c.x, pos.z - c.z)
	var out := Vector2(dir.x, dir.z)
	var cut := false
	for i in 2:
		var ahead: float = rel[i] + out[i] * EDGE_LOOK
		if absf(ahead) > h[i]:
			out[i] = clampf((signf(ahead) * h[i] - rel[i]) / EDGE_LOOK, -1.0, 1.0)
			cut = true
	if cut and out.length() < 0.5 * Vector2(dir.x, dir.z).length():
		_strafe = -_strafe
		_strafe_t = rng.randf_range(0.5, 1.3)
	return Vector3(out.x, 0.0, out.y)

func _pick_goal() -> void:
	if game == null or game.slab == null:
		return
	if _pushing() and push_point != Vector3.INF:
		goal = push_point + Vector3(rng.randf_range(-1.0, 1.0), 0.0, rng.randf_range(-1.0, 1.0))
		agent.target_position = goal
		return
	var s: Vector2 = game.slab.size
	var c: Vector3 = game.slab.center
	goal = c + Vector3(rng.randf_range(-0.35, 0.35) * s.x, 0.0, rng.randf_range(-0.35, 0.35) * s.y)
	agent.target_position = goal

static func _turn(a: Vector3, b: Vector3, max_angle: float) -> Vector3:
	var ang := a.angle_to(b)
	if ang <= max_angle or ang < 1e-4:
		return b
	if ang > 3.1:
		return a.rotated(Vector3.UP, max_angle).normalized()
	return a.slerp(b, max_angle / ang).normalized()

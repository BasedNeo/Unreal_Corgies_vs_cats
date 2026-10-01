extends RefCounted
## G-MOVE (W13): nobody has to jump to get from a spawn to the slab, and a kerb up to the step height is taken in
## stride while a taller one still blocks.
## 1. Routes. A player-controlled pet of each species stands at each team's match-start spawn (spawn_points(t)[0]),
##    facing the slab, and the test presses only move_forward (then move_forward + sprint); no jump, no turning.
##    Each must reach the slab within the straight-line time at that gait's speed plus 30 %, and never stall
##    (horizontal speed under 1 m/s) for 0.5 s or more. The 30 % is measured overhead (12-17 %) plus margin: the
##    Corgi runners go up the slab path's 26.6 deg ramp out of the pit and down and up through trenches T1 and T3
##    (SLAB_PATH in src/shared/world/lot/layout.ts), and every runner slides 2-3 s at 1.2-1.8 m/s along the pallet
##    stack about 20 m short of the slab. The test bites: on the W12 terrain (65.6 deg pit and trench walls, over the
##    52 deg floor limit, the web KCC's) the Corgi-spawn runners stall in trench T1 or slide along its walls off the
##    line and miss the slab; with W12 movement (no step-up, Godot's 15 deg head-on wall stop) every runner stalls
##    dead against that pallet stack.
## 2. Step-up. On a test deck 60 m over the slab, a pet of each species runs at a 0.40 m kerb (it must end up on top,
##    by a step) and at a 0.55 m block (over STEP_HEIGHT 0.45: it must stay in front of it).
## Pets use one movement model (pet.gd move_pet), so bots get the same step and slope rules as the player.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Player := preload("res://game/player.gd")
const Pet := preload("res://game/pet.gd")
const SPEED := 4.0  # run at 4x, 240 physics ticks per real second: every tick still steps 1/60 s
const SLACK := 1.3
const STALL_SPEED := 1.0
const STALL_MAX := 0.5
const DT := 1.0 / 60.0
## Read without naming pet.gd's new members, so this file also runs against the W12 pet.gd (to show it failing there).
var step_height: float = (load("res://game/pet.gd") as Script).get_script_constant_map().get("STEP_HEIGHT", 0.45)

static func _steps_of(p: Node) -> int:
	return int(p.get("steps")) if p.get("steps") != null else 0

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": false, "allies": 0, "enemies": 0, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.slab == null or game.spawns[0].is_empty() or game.spawns[1].is_empty():
		errs.append("match did not start with a slab and spawns")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var runners: Array = []
	for team in 2:
		for species in 2:
			var r: Node = Player.new()
			r.configure(team, species, "%s from the %s spawn" % [["Corgi", "Cat"][species], ["Corgi", "Cat"][team]], game.look)
			r.game = game
			game.add_child(r)
			r.collision_mask = T.L_WORLD  # two runners share each spawn: let them pass through each other
			runners.append(r)
	for gait in ["run", "sprint"]:
		errs.append_array(await _routes(tree, game, runners, gait))
	errs.append_array(await _steps(tree, game, runners))
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	for a in ["move_forward", "sprint"]:
		Input.action_release(a)
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## Runs `runners` (Player pets) at the slab pressing only move_forward (+ sprint for gait "sprint"), each from
## starts[runner] (default: its team's match-start spawn); returns failure strings. Also used by test_game_respawn.gd.
func _routes(tree: SceneTree, game: Node, runners: Array, gait: String, starts: Dictionary = {}) -> Array:
	var errs: Array = []
	var c: Vector3 = game.slab.center
	var st := {}
	var limit := 0.0
	for r in runners:
		var from: Vector3 = starts.get(r, game.spawns[r.team][0])
		r.respawn(from, atan2(-(c.x - from.x), -(c.z - from.z)))
		var dist := Vector2(c.x - from.x, c.z - from.z).length()
		var budget: float = dist / float(r.m[gait]) * SLACK
		limit = maxf(limit, budget)
		st[r] = {"dist": dist, "budget": budget, "reached": -1.0, "stall": 0.0, "worst": 0.0, "worst_at": Vector3.ZERO,
			"last": from, "vy": 0.0}
	await Kit.physics(tree, 10)  # settle on the ground
	for r in runners:
		st[r].last = r.global_position
	Input.action_press("move_forward")
	if gait == "sprint":
		Input.action_press("sprint")
	var t := 0.0
	var left := runners.size()
	while left > 0 and t < limit + 1.0:
		await tree.physics_frame
		t += DT
		for r in runners:
			var s: Dictionary = st[r]
			if s.reached >= 0.0:
				continue
			var pos: Vector3 = r.global_position
			s.vy = maxf(s.vy, r.velocity.y)
			if game.slab.contains(pos):
				s.reached = t
				left -= 1
				continue
			var hs := Vector2(pos.x - s.last.x, pos.z - s.last.z).length() / DT
			s.last = pos
			s.stall = s.stall + DT if hs < STALL_SPEED and t > 0.3 else 0.0
			if s.stall > s.worst:
				s.worst = s.stall
				s.worst_at = pos
	Input.action_release("move_forward")
	Input.action_release("sprint")
	for r in runners:
		var s: Dictionary = st[r]
		var what := "%s, %s (%.1f m, %.1f m/s)" % [r.display_name, gait, s.dist, r.m[gait]]
		if s.reached < 0.0:
			errs.append("%s: did not reach the slab in %.1f s; ended at (%.1f, %.2f, %.1f), longest stall %.1f s at (%.1f, %.2f, %.1f)" % [
				what, t, r.global_position.x, r.global_position.y, r.global_position.z, s.worst, s.worst_at.x, s.worst_at.y, s.worst_at.z])
			continue
		print("  %s: slab in %.2f s (budget %.2f s), longest stall %.2f s, steps %d" % [what, s.reached, s.budget, s.worst, _steps_of(r)])
		if s.reached > s.budget:
			errs.append("%s: reached the slab in %.2f s, budget %.2f s" % [what, s.reached, s.budget])
		if s.worst >= STALL_MAX:
			errs.append("%s: stalled %.1f s at (%.1f, %.2f, %.1f)" % [what, s.worst, s.worst_at.x, s.worst_at.y, s.worst_at.z])
		if s.vy > 2.0:
			errs.append("%s: rose at %.1f m/s (a jump?) with only move_forward pressed" % [what, s.vy])
	return errs

func _steps(tree: SceneTree, game: Node, runners: Array) -> Array:
	var errs: Array = []
	var base: Vector3 = game.slab.center + Vector3(0, 60, 0)
	var deck := StaticBody3D.new()
	deck.name = "StepTestDeck"
	deck.collision_layer = T.L_WORLD
	deck.collision_mask = 0
	game.add_child(deck)
	deck.global_position = base
	_box(deck, Vector3(0, -0.5, 0), Vector3(30, 1, 30))
	# lanes along -Z (yaw 0): [species, block height]; the block's near face is at z = 0
	var lanes := [[T.CORGI, 0.40], [T.CAT, 0.40], [T.CORGI, 0.55], [T.CAT, 0.55]]
	var pets: Array = []
	for i in lanes.size():
		var x := -7.5 + 5.0 * i
		_box(deck, Vector3(x, lanes[i][1] * 0.5, -4.0), Vector3(2.4, lanes[i][1], 8.0))
		var r: Node = null
		for cand in runners:
			if cand.species == lanes[i][0] and not (cand in pets):
				r = cand
				break
		pets.append(r)
		r.respawn(base + Vector3(x, 0.05, 4.0), 0.0)
		r.set("steps", 0)
	await Kit.physics(tree, 10)
	Input.action_press("move_forward")
	await Kit.physics(tree, 90)  # 1.5 s at run speed: 4 m to the face, then 1-2 m more
	Input.action_release("move_forward")
	await Kit.physics(tree, 20)
	for i in lanes.size():
		var r: Node = pets[i]
		var h: float = lanes[i][1]
		var rel: Vector3 = r.global_position - base
		var what := "%s at a %.2f m block" % [["Corgi", "Cat"][r.species], h]
		if h <= step_height:
			if absf(rel.y - h) > 0.06 or rel.z > -0.5 or _steps_of(r) == 0:
				errs.append("%s: not stepped up (feet %.2f m over the deck, z %.2f, %d steps)" % [what, rel.y, rel.z, _steps_of(r)])
		elif rel.y > 0.06 or rel.z < 0.2:
			errs.append("%s: got over a block taller than the %.2f m step (feet %.2f m, z %.2f)" % [what, step_height, rel.y, rel.z])
		print("  %s: feet %.2f m over the deck, z %.2f, steps %d" % [what, rel.y, rel.z, _steps_of(r)])
	deck.queue_free()
	return errs

func _box(parent: Node3D, pos: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = size
	cs.shape = b
	cs.position = pos
	parent.add_child(cs)

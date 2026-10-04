extends RefCounted
## G-BOT (W15 ROLES, REMATCH): 2v2 bot roles, and a rematch puts every bot back to its start-of-match state.
## 1. Roles by format (one boot, the format switched by match.gd's own _spawn_pets): bots-only 2v2, each team has one
##    HOLD (start slot 1) and one APPROACH (slot 2); 1v1, both bots HOLD; you + a Corgi bot against two Cat bots,
##    your ally HOLDS (its team has one bot) and the Cats split HOLD / APPROACH.
## 2. APPROACH goes for its post: within APPROACH_S s of the start its post is found (PUSH_DIST m from the slab's
##    centre, on the enemy's nav path in), its goal is there, and it is not stepping on yet.
##    This checks intent (role, post, goal), not arrival: it does not prove an APPROACH bot reaches or keeps its post.
##    In play it is at its post under 1 % of its alive time (docs/qa/w15/bot-roles.md, "Roles are nominal").
## 3. Rematch: a bots-only 2v2 plays MID_S s (targets seen, shots, the APPROACH post found, maybe deaths). KILL_S s
##    before the rematch each team's HOLD bot is killed, so its APPROACH teammate steps on (no holder alive) and the
##    step-on latch is set when game.rematch() runs: a respawn that fails to reset it fails this test every run, not
##    only when play happened to set it. The APPROACH bots are kept unhurt for the last GUARD_S s so they are alive to
##    step on. Every bot must then be back where start_match put it the first time: alive, full HP, at its start slot,
##    the same role, no target, every think timer and latch at its start value, no post and no post facing yet, and a
##    goal (with the nav agent's target on it) on the slab.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Bot := preload("res://game/bot.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const APPROACH_S := 2.0
const MID_S := 30.0
const KILL_S := 2.0  # the HOLD bots die this long before the rematch (respawn takes T.RESPAWN_TIME, 3 s)
const GUARD_S := KILL_S + T.RESPAWN_TIME  # an APPROACH bot that died before this is alive again at the kill
const NAMES := ["HOLD", "APPROACH"]

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": false, "allies": 1, "enemies": 2, "think": true})
	var game: Node = main.get_node("Game")
	for i in 600:
		if game.nav_ready():
			break
		await tree.physics_frame
	if not game.playing() or game.pets.size() != 4 or not game.nav_ready():
		errs.append("bots-only 2v2 did not start with a ready nav map")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	# 1. roles by format
	errs.append_array(await _roles(tree, game, {"human": false, "allies": 0, "enemies": 1}, "1v1 bots-only",
		[[Bot.ROLE_HOLD], [Bot.ROLE_HOLD]]))
	errs.append_array(await _roles(tree, game, {"human": true, "allies": 1, "enemies": 2}, "2v2 with you",
		[[Bot.ROLE_HOLD], [Bot.ROLE_HOLD, Bot.ROLE_APPROACH]]))
	errs.append_array(await _roles(tree, game, {"human": false, "allies": 1, "enemies": 2}, "2v2 bots-only",
		[[Bot.ROLE_HOLD, Bot.ROLE_APPROACH], [Bot.ROLE_HOLD, Bot.ROLE_APPROACH]]))
	var start := {}
	for p in game.pets:
		start[p] = _state(game, p)
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	# 2. APPROACH heads for its post
	await _play(tree, game, APPROACH_S)
	for p in game.pets:
		if p.role != Bot.ROLE_APPROACH:
			continue
		if p.push_point == Vector3.INF:
			errs.append("%s (APPROACH) found no post in %.0f s" % [p.display_name, APPROACH_S])
			continue
		var d := Vector2(p.push_point.x - game.slab.center.x, p.push_point.z - game.slab.center.z).length()
		if absf(d - Bot.PUSH_DIST) > 0.5 or p.goal.distance_to(p.push_point) > 1.5 or p._stepping_on:
			errs.append("%s (APPROACH): post %.1f m from the slab's centre (want %.0f), goal %.1f m from it, stepping on %s" % [
				p.display_name, d, Bot.PUSH_DIST, p.goal.distance_to(p.push_point), str(p._stepping_on)])
	# 3. mid-match rematch, with the step-on latch set
	await _play(tree, game, MID_S - APPROACH_S - GUARD_S)
	await _play(tree, game, GUARD_S - KILL_S, true)
	for p in game.pets:
		if p.get("think") != null and p.role == Bot.ROLE_HOLD:
			p.die(null)
	await _play(tree, game, KILL_S, true)
	for p in game.pets:
		if p.get("think") != null and p.role == Bot.ROLE_APPROACH and not (p.alive and p._stepping_on and p._step_on_t > 0.0):
			errs.append("%s (APPROACH) before the rematch: alive %s, stepping on %s, step-on %.1f s; want it stepping on (its holder is down)" % [
				p.display_name, str(p.alive), str(p._stepping_on), p._step_on_t])
	var moved := 0
	for p in game.pets:
		if _state(game, p) != start[p]:
			moved += 1
	if moved == 0:
		errs.append("after %.0f s of play no bot's state differs from the start: the rematch check would prove nothing" %
			MID_S)
	game.rematch()
	for p in game.pets:
		var now := _state(game, p)
		if now != start[p]:
			var diff: Array = []
			for k in now:
				if now[k] != start[p].get(k):
					diff.append("%s %s (start %s)" % [k, str(now[k]), str(start[p].get(k))])
			errs.append("%s after the rematch: %s" % [p.display_name, ", ".join(diff)])
	print("  roles: after %.0f s, %d of 4 bots had left their start state; after the rematch %d match it" % [MID_S, moved,
		game.pets.filter(func(p): return _state(game, p) == start[p]).size()])
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## Switches the format the way match.gd's F2 toggle does (_spawn_pets, start_match) and checks each team's bot roles,
## in start-slot order.
func _roles(tree: SceneTree, game: Node, o: Dictionary, label: String, want: Array) -> Array:
	var errs: Array = []
	for k in o:
		game.opts[k] = o[k]
	game._spawn_pets()
	await tree.process_frame
	game.start_match()
	for t in 2:
		var bots: Array = game.pets.filter(func(p): return p.team == t and p.get("think") != null)
		bots.sort_custom(func(a, b): return int(a.get_meta("slot", 0)) < int(b.get_meta("slot", 0)))
		var got: Array = bots.map(func(p): return int(p.role))
		print("  roles %s: %s %s" % [label, ["Corgi", "Cat"][t], str(got.map(func(r): return NAMES[r]))])
		if got != want[t]:
			errs.append("%s: %s bots have roles %s, want %s" % [label, ["Corgi", "Cat"][t],
				str(got.map(func(r): return NAMES[r])), str(want[t].map(func(r): return NAMES[r]))])
	return errs

## Plays `secs` s of game time; `guard` keeps the APPROACH bots unhurt meanwhile.
func _play(tree: SceneTree, game: Node, secs: float, guard := false) -> void:
	var t := 0.0
	while t < secs and game.playing():
		if guard:
			for p in game.pets:
				if p.get("think") != null and p.role == Bot.ROLE_APPROACH and p.alive:
					p.shield = 1.0
		await tree.physics_frame
		t += 1.0 / 60.0

## The think state a rematch must reset, rounded so that equal means equal.
func _state(game: Node, p: Node) -> Dictionary:
	var c: Vector3 = game.slab.center
	var slot: int = int(p.get_meta("slot", 1))
	var at: Vector3 = game.start_slots(p.team)[slot - 1]
	return {
		"alive": p.alive, "hp": p.hp, "role": p.role, "at_start_slot": Vector2(p.global_position.x - at.x,
			p.global_position.z - at.z).length() < 0.5,
		"target": p.target, "target_visible": p.target_visible, "seen": p.seen, "lost": p.lost, "heard": p._heard,
		"heard_t": p._heard_t, "stuck_t": p._stuck_t, "pause": p._pause, "burst": p._burst, "strafe": p._strafe,
		"strafe_t": p._strafe_t,
		"want_jump": p._want_jump, "step_on_t": p._step_on_t, "stepping_on": p._stepping_on,
		"post": p.push_point == Vector3.INF, "push_look": p.push_look, "goal_on_slab": game.slab.contains(p.goal),
		"agent_on_goal": p.agent.target_position.distance_to(p.goal) < 0.01,
	}

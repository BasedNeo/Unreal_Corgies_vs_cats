extends RefCounted
## G-BOT (W15 ROLES, REMATCH): 2v2 bot roles, and a rematch puts every bot back to its start-of-match state.
## 1. Roles by format (one boot, the format switched by match.gd's own _spawn_pets): bots-only 2v2, each team has one
##    HOLD (start slot 1) and one APPROACH (slot 2); 1v1, both bots HOLD; you + a Corgi bot against two Cat bots,
##    your ally HOLDS (its team has one bot) and the Cats split HOLD / APPROACH.
## 2. APPROACH goes for its post: within APPROACH_S s of the start its post is found (PUSH_DIST m from the slab's
##    centre, on the enemy's nav path in), its goal is there, and it is not stepping on yet.
##    This checks intent (role, post, goal), not arrival: it does not prove an APPROACH bot reaches or keeps its post.
##    In play it is at its post under 1 % of its alive time (docs/qa/w15/bot-roles.md, "Roles are nominal"; W17
##    measured 0.1-0.5 %). An arrival-and-keeping check exists for the W17 candidate whose bot.gd fixes the trap
##    (docs/qa/w17/BOT-ROLES.md, "Arrival test"). It is not in this file because no option passed the balance bar, so
##    the shipped bot.gd keeps the trap and would fail it.
## 3. Rematch: a bots-only 2v2 plays MID_S s (targets seen, shots, the APPROACH post found, maybe deaths). KILL_S s
##    before the rematch each team's HOLD bot is killed, so its APPROACH teammate steps on (no holder alive) and the
##    step-on latch is set when game.rematch() runs: a respawn that fails to reset it fails this test every run, not
##    only when play happened to set it. The APPROACH bots are kept unhurt for the last GUARD_S s so they are alive to
##    step on. Every bot must then be back where start_match put it the first time: alive, full HP, at its start slot,
##    the same role, no target, every think timer and latch at its start value, no post and no post facing yet, and a
##    goal (with the nav agent's target on it) on the slab.
## 4. Aim parity (W17 G-BAL, bot.gd AIM_EYE / AIM_CHEST): a Corgi bot and a Cat bot stand PARITY_GAP m apart on the
##    slab, held in place and unhurt, the others parked out of sight. Each in turn thinks for PARITY_S s while the other
##    stands still; each must have the other in sight and aim along the same line: pitches at most PARITY_TOL rad
##    apart. With each species' own pet.gd eye() and chest() (the W17 shipped aim) the Cat looks 0.32 m down and the
##    Corgi 0.24 m: 0.026 rad apart at 3 m on flat ground; 0.0284 measured on the slab. This pins the aim tracking.
## 5. Every aim site uses the parity helpers (G-BAL landing condition):
##    - AIM_EYE and AIM_CHEST still equal the Corgi's pet.gd eye and chest (0.78 and 0.55 of T.height(CORGI)).
##    - For a Corgi bot and a Cat bot, _eye() is AIM_EYE and _aim_point() is AIM_CHEST over the feet.
##    - A spy bot whose _eye() is lifted (SpyBot) faces a still, unhurt enemy SITE_GAP m away on the slab, three times:
##      - lifted VIEW_LIFT m, past bot.gd VIEW_DIST: it must never see the enemy (the view check in _think measures from
##        _eye() to _aim_point());
##      - lifted SITE_LIFT m under a test-only plate that covers only the lifted line of sight: it must never see the
##        enemy (_los() casts from _eye());
##      - lifted SITE_LIFT m in the open: it must fire at least SITE_SHOTS shots, and at least SITE_HITS of them must
##        hit (_shoot() gates the FIRE_CONE from _eye() and fires from _eye(): from the pet.gd eye, along the lifted
##        aim, every shot lands in the ground).
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Bot := preload("res://game/bot.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const APPROACH_S := 2.0
const MID_S := 30.0
const KILL_S := 2.0  # the HOLD bots die this long before the rematch (respawn takes T.RESPAWN_TIME, 3 s)
const GUARD_S := KILL_S + T.RESPAWN_TIME  # an APPROACH bot that died before this is alive again at the kill
const NAMES := ["HOLD", "APPROACH"]
const PARITY_GAP := 3.0
const PARITY_S := 1.5
const PARITY_TOL := 0.008
const SITE_GAP := 5.0
const SITE_S := 1.0
const VIEW_LIFT := 61.0  # over bot.gd VIEW_DIST (60 m) on its own
const SITE_LIFT := 3.0
const SITE_SHOTS := 3
const SITE_HITS := 0.5

## Part 5's spy: bot.gd with its eye lifted eye_lift m over AIM_EYE. Every aim site that goes through _eye() follows it.
class SpyBot extends "res://game/bot.gd":
	var eye_lift := 0.0
	func _eye() -> Vector3:
		return global_position + Vector3(0, AIM_EYE + eye_lift, 0)

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
	# 4. aim parity
	errs.append_array(await _aim_parity(tree, game))
	# 5. every aim site on the parity helpers
	errs.append_array(await _aim_sites(tree, game))
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## Part 4: a Corgi bot and a Cat bot on the slab, each in turn aiming at the other, which stands still; both held in
## place and unhurt. Each aims for PARITY_S s, then the two aim pitches are compared.
func _aim_parity(tree: SceneTree, game: Node) -> Array:
	var errs: Array = []
	game.start_match()
	var pair: Array = []
	for t in 2:
		pair.append(game.pets.filter(func(p): return p.team == t and p.get("think") != null)[0])
	for p in game.pets:
		if not pair.has(p):
			p.think = false
			p.respawn(game.spawns[p.team][15], 0.0)
	var c: Vector3 = game.slab.center
	var at: Array = []
	for t in 2:
		var hit: Dictionary = game._ground_hit(c + Vector3(0.0, 0.0, (t - 0.5) * PARITY_GAP))
		at.append(hit.position if not hit.is_empty() else c)
	var pitch := [0.0, 0.0]
	var saw := [false, false]
	for s in 2:  # s aims, the other stands
		for t in 2:
			pair[t].respawn(at[t], game._yaw_to(at[t], at[1 - t]))
			pair[t].think = t == s
		var tt := 0.0
		while tt < PARITY_S and game.playing():
			game.score = [0, 0]
			game.time_left = T.MATCH_TIME
			for t in 2:
				pair[t].global_position = at[t]
				pair[t].velocity = Vector3.ZERO
				pair[t].shield = 1.0
			await tree.physics_frame
			tt += 1.0 / 60.0
		pitch[s] = asin(clampf(pair[s].aim_dir.y, -1.0, 1.0))
		saw[s] = pair[s].target == pair[1 - s] and pair[s].target_visible
	print("  roles: aim parity at %.0f m: Corgi bot aims %.4f rad at the Cat, Cat bot %.4f rad at the Corgi (in sight: %s, %s)" % [
		PARITY_GAP, pitch[0], pitch[1], str(saw[0]), str(saw[1])])
	if not (saw[0] and saw[1]):
		errs.append("aim parity: a bot did not have the other in sight after %.1f s (Corgi %s, Cat %s)" % [PARITY_S,
			str(saw[0]), str(saw[1])])
	elif absf(pitch[0] - pitch[1]) > PARITY_TOL:
		errs.append("aim parity: the Corgi bot aims at %.4f rad and the Cat bot at %.4f rad, %.4f apart (max %.3f): one species looks down at the other more steeply" % [
			pitch[0], pitch[1], absf(pitch[0] - pitch[1]), PARITY_TOL])
	for p in game.pets:
		p.think = true
	return errs

## Part 5: the constants, the helpers for both species, and a spy bot for the view check, _los, the fire cone and the
## shot origin.
func _aim_sites(tree: SceneTree, game: Node) -> Array:
	var errs: Array = []
	var h0: float = T.height(T.CORGI)
	if absf(Bot.AIM_EYE - h0 * 0.78) > 1e-6 or absf(Bot.AIM_CHEST - h0 * 0.55) > 1e-6:
		errs.append("aim sites: AIM_EYE %.4f and AIM_CHEST %.4f are not the Corgi's pet.gd eye %.4f and chest %.4f any more (tuning.gd MOVE[0] changed?)" % [
			Bot.AIM_EYE, Bot.AIM_CHEST, h0 * 0.78, h0 * 0.55])
	game.start_match()
	var bots: Array = []
	for t in 2:
		bots.append(game.pets.filter(func(p): return p.team == t and p.get("think") != null)[0])
	for b in bots:
		var eh: float = b._eye().y - b.global_position.y
		var ah: float = Bot._aim_point(b).y - b.global_position.y
		if absf(eh - Bot.AIM_EYE) > 1e-5 or absf(ah - Bot.AIM_CHEST) > 1e-5:
			errs.append("aim sites: %s (species %d) looks from %.4f m and is aimed at %.4f m over its feet, want %.4f and %.4f" % [
				b.display_name, b.species, eh, ah, Bot.AIM_EYE, Bot.AIM_CHEST])
	var foe: Node = bots[1]
	var spy = SpyBot.new()
	spy.configure(0, T.CAT, "Spy Cat", game.look)
	spy.name = "SpyCat"
	spy.game = game
	spy.think = false
	game.add_child(spy)
	for p in game.pets:
		if p != foe:
			p.think = false
			p.respawn(game.spawns[p.team][15], 0.0)
	game.pets = [spy, foe]
	var c: Vector3 = game.slab.center
	var at_spy: Vector3 = game._ground_hit(c + Vector3(0, 0, -SITE_GAP * 0.5)).position
	var at_foe: Vector3 = game._ground_hit(c + Vector3(0, 0, SITE_GAP * 0.5)).position
	# a test-only plate, 2.4 m up between them: it crosses the lifted line of sight, not the pet.gd one (under 1 m up)
	var plate := StaticBody3D.new()
	plate.collision_layer = T.L_WORLD
	plate.collision_mask = 0
	var ps := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(2.0, 0.2, 3.0)
	ps.shape = box
	plate.add_child(ps)
	var cases := [["view distance (_think)", VIEW_LIFT, false], ["line of sight (_los)", SITE_LIFT, true],
		["fire cone and shot origin (_shoot)", SITE_LIFT, false]]
	var shots := [0, 0]
	var on_fire := func(res: Dictionary) -> void:
		shots[0] += 1
		if res.get("target") == foe:
			shots[1] += 1
	spy.rifle.fired.connect(on_fire)
	for k in cases.size():
		var label: String = cases[k][0]
		spy.eye_lift = float(cases[k][1])
		if cases[k][2]:
			game.add_child(plate)
			plate.global_position = Vector3(c.x, at_spy.y + 2.4, c.z - 0.2)
		spy.respawn(at_spy, game._yaw_to(at_spy, at_foe))
		foe.respawn(at_foe, game._yaw_to(at_foe, at_spy))
		spy.think = true
		shots[0] = 0
		shots[1] = 0
		var saw := false
		var tt := 0.0
		while tt < SITE_S and game.playing():
			game.score = [0, 0]
			game.time_left = T.MATCH_TIME
			spy.global_position = at_spy
			spy.velocity = Vector3.ZERO
			foe.global_position = at_foe
			foe.velocity = Vector3.ZERO
			foe.shield = 1.0
			await tree.physics_frame
			tt += 1.0 / 60.0
			saw = saw or (spy.target == foe and spy.target_visible)
		spy.think = false
		if cases[k][2]:
			game.remove_child(plate)
		print("  roles: aim site %s, eye lifted %.0f m: saw the enemy %s, %d shots, %d hits" % [label, spy.eye_lift, str(saw),
			shots[0], shots[1]])
		if k < 2 and saw:
			errs.append("aim site %s: with its eye lifted %.0f m the spy still saw the enemy: that check does not use _eye() / _aim_point()" % [
				label, spy.eye_lift])
		if k == 2 and (shots[0] < SITE_SHOTS or shots[1] < SITE_HITS * shots[0]):
			errs.append("aim site %s: with its eye lifted %.0f m the spy fired %d shots (min %d) and hit with %d (min %.0f %%): the fire cone or the shot origin does not use _eye() / _aim_point()" % [
				label, spy.eye_lift, shots[0], SITE_SHOTS, shots[1], 100.0 * SITE_HITS])
	spy.rifle.fired.disconnect(on_fire)
	plate.free()
	game.pets.erase(spy)
	spy.queue_free()
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

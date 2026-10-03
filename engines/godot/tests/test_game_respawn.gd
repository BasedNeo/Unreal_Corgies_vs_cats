extends RefCounted
## G-MOVE (W14), G-BOT (W15): a respawn, and a match start, cost each team the trip to the slab match.gd intends: the
## same for both under W14's rule, and on The Lot the Corgis' plus CAT_OFFSET for the Cats.
## 1. In a 2v2 (the human and a Corgi bot against two Cat bots, bots frozen), ROUNDS rounds each place the living pets
##    somewhere on the map (the slab, either half, either base) and down one pet of each team in the same tick, by
##    turns the human + Cat bot 1 and the Corgi bot + Cat bot 2, then all four together. Every respawn point must be
##    one of the team's match.gd respawn_slots, and two pets of a team that respawn together must not share a point.
## 2. Measured trips (W15). A lone bot of each team (thinking, with no enemy in game.pets, so it sprints) runs to the
##    slab's edge from each 2v2 start slot and from every distinct respawn point seen. Its goal is the slab's centre, a
##    fixed goal, so each run is deterministic. A Cat trip less match.gd's CAT_OFFSET (the Cats' measured head start
##    in a match, given back at the slots) must match the Corgis' slot k within BAND s, and every Cat respawn every
##    Corgi respawn the same way. HEAD's W14 match.gd (straight-line slots, no CAT_OFFSET, so 0) fails it twice: start
##    slot 0, the Cats' (62, 117), is 0.40 s off the Corgis', and the respawn (56, 117) is 0.62 s off. The Cats' W14
##    slot 1 (74, 105) and respawn (68, 111) would be 0.7-0.9 s off only with CAT_OFFSET 0.6 applied to them; at
##    offset 0 the slot is 0.25 s off and passes. Each measured trip must also stay within DRIFT s of the value
##    match.gd keeps beside its slot (CAT_SLOTS, CORGI_TRIPS: the mean of 11 runs with random goals), so a change to the
##    map, the bot or the movement that moves a trip shows up here.
## 3. A Player pet of each team's species, from every distinct respawn point seen, presses only move_forward (then
##    move_forward + sprint) and must reach the slab like test_game_stepup.gd's runners (same helper: straight-line
##    time + 30 %, no stall of 0.5 s).
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Player := preload("res://game/player.gd")
const Bot := preload("res://game/bot.gd")
const Stepup := preload("res://tests/test_game_stepup.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const BAND := 0.3
const DRIFT := 0.4
const ROUNDS := 8
const TEAM := ["Corgi", "Cat"]
## Where the pets that stay up stand, per round (x, z; on the ground found by a ray): the slab, mid-field on either
## side, at either base, on the Corgis' slab path.
const SPOTS := [[2, -3], [-30, -50], [35, 55], [-60, -112], [60, 112], [-50, -80], [12, 30], [-6, 6]]

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 1, "enemies": 2, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.pets.size() != 4 or game.player == null:
		errs.append("2v2 with the human did not start")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	for i in 600:
		if game.nav_ready():
			break
		await tree.physics_frame
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var corgis: Array = game.pets.filter(func(p): return p.team == 0)  # [the human, the Corgi bot]
	var cats: Array = game.pets.filter(func(p): return p.team == 1)
	var c: Vector3 = game.slab.center
	var seen := [[], []]  # respawn points per team
	for k in ROUNDS + 1:
		var down: Array = [corgis[k % 2], cats[k % 2]] if k < ROUNDS else game.pets.duplicate()
		var i := 0
		for p in game.pets:
			if not p in down:
				var s: Array = SPOTS[(k + i * 3) % SPOTS.size()]
				var g: Dictionary = game._ground_hit(Vector3(s[0], 0, s[1]))
				p.global_position = (g.position if not g.is_empty() else Vector3(s[0], 0, s[1])) + Vector3(0, 0.05, 0)
				i += 1
		for p in down:
			p.die(game.pets[0] if p.team == 1 else game.pets[2])
		var waited := 0
		while down.any(func(p): return not p.alive) and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
			await tree.physics_frame
			waited += 1
		var got: Array = [[], []]
		for p in down:
			if not p.alive:
				errs.append("round %d: %s did not respawn" % [k, p.display_name])
				continue
			var at: Vector3 = p.global_position
			if not game.respawn_slots[p.team].any(func(q): return Vector2(q.x - at.x, q.z - at.z).length() < 0.3):
				errs.append("round %d: %s respawned at (%.1f, %.1f), not one of its respawn points" % [k, p.display_name,
					at.x, at.z])
			got[p.team].append(at)
			if not seen[p.team].any(func(q): return Vector2(q.x - at.x, q.z - at.z).length() < 0.5):
				seen[p.team].append(at)
		for t in 2:
			if got[t].size() == 2 and (got[t][0] as Vector3).distance_to(got[t][1]) < 1.0:
				errs.append("round %d: both %ss respawned on one point" % [k, TEAM[t]])
	for t in 2:
		print("  respawn %s: %d distinct points over %d rounds" % [TEAM[t], seen[t].size(), ROUNDS + 1])
	# 2. measured trips from the start slots and the respawn points
	for p in game.pets:
		p.set_physics_process(false)  # the 2v2 stands aside
	var data := _data(game)
	var offset := float(data.get("CAT_OFFSET", 0.0))
	var trips := [[], []]  # [point, measured s, data s or -1, label]
	for t in 2:
		var pts: Array = []  # [point, label]
		var slots: Array = game.start_slots(t)
		for k in 2:
			pts.append([slots[k], "start slot %d" % k])
		for q in seen[t]:
			pts.append([q, "respawn"])
		var got: Array = await _trips(tree, game, t, pts.map(func(e): return e[0]))
		for k in pts.size():
			trips[t].append([pts[k][0], got[k], _data_trip(game, data, t, pts[k][0], pts[k][1]), pts[k][1]])
	for t in 2:
		for r in trips[t]:
			print("  trip %s %s (%.1f, %.1f): %s · match.gd %s" % [TEAM[t], r[3], r[0].x, r[0].z,
				"%.2f s" % r[1] if r[1] >= 0.0 else "NOT REACHED", "%.2f s" % r[2] if r[2] >= 0.0 else "-"])
			if r[1] < 0.0:
				errs.append("%s bot from %s (%.1f, %.1f) did not reach the slab" % [TEAM[t], r[3], r[0].x, r[0].z])
			elif r[2] >= 0.0 and absf(r[1] - r[2]) > DRIFT:
				errs.append("%s %s (%.1f, %.1f): measured trip %.2f s, match.gd says %.2f s (drift over %.1f s)" % [TEAM[t],
					r[3], r[0].x, r[0].z, r[1], r[2], DRIFT])
	print("  CAT_OFFSET %.2f s" % offset)
	for k in 2:
		var a: Array = trips[0][k]
		var b: Array = trips[1][k]
		if a[1] >= 0.0 and b[1] >= 0.0 and absf(a[1] - (b[1] - offset)) > BAND:
			errs.append("start slot %d: Corgi (%.1f, %.1f) %.2f s against Cat (%.1f, %.1f) %.2f s less %.2f s (want within %.1f s)" % [
				k, a[0].x, a[0].z, a[1], b[0].x, b[0].z, b[1], offset, BAND])
	var worst := 0.0
	var pair := []
	for a in trips[0].filter(func(r): return r[3] == "respawn" and r[1] >= 0.0):
		for b in trips[1].filter(func(r): return r[3] == "respawn" and r[1] >= 0.0):
			if absf(a[1] - (b[1] - offset)) > worst:
				worst = absf(a[1] - (b[1] - offset))
				pair = [a, b]
	print("  respawn: largest Corgi-Cat measured trip gap, the Cats' less CAT_OFFSET, %.2f s" % worst)
	if worst > BAND:
		errs.append("respawns: Corgi (%.1f, %.1f) %.2f s against Cat (%.1f, %.1f) %.2f s less %.2f s (want within %.1f s)" % [
			pair[0][0].x, pair[0][0].z, pair[0][1], pair[1][0].x, pair[1][0].z, pair[1][1], offset, BAND])
	# 3. walk back from every distinct respawn point
	var runners: Array = []
	var starts := {}
	for t in 2:
		for at in seen[t]:
			var r: Node = Player.new()
			r.configure(t, t, "%s from the respawn at (%.1f, %.1f)" % [TEAM[t], at.x, at.z], game.look)
			r.game = game
			game.add_child(r)
			r.collision_mask = T.L_WORLD  # runners pass through each other and the 2v2
			runners.append(r)
			starts[r] = at
	var helper = Stepup.new()
	for gait in ["run", "sprint"]:
		errs.append_array(await helper._routes(tree, game, runners, gait, starts))
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	for a in ["move_forward", "sprint"]:
		Input.action_release(a)
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## Lone bots of `team`, one per point, sprint at the slab's centre together (they pass through each other and nobody
## else is in game.pets, so nobody fights). Returns each one's time to the slab's edge, -1 if not reached in 40 s.
func _trips(tree: SceneTree, game: Node, team: int, pts: Array) -> Array:
	var keep: Array = game.pets
	var c: Vector3 = game.slab.center
	var bots: Array = []
	for i in pts.size():
		var b: Node = Bot.new()
		b.configure(team, team, "Trip %s %d" % [TEAM[team], i], game.look)
		b.name = "Trip%s%d" % [TEAM[team], i]
		b.game = game
		game.add_child(b)
		b.collision_mask = T.L_WORLD
		bots.append(b)
	game.pets = bots
	await tree.physics_frame
	for i in bots.size():
		var sp: Vector3 = pts[i]
		bots[i].respawn(sp, atan2(-(c.x - sp.x), -(c.z - sp.z)))
		bots[i].goal = c
		bots[i].agent.target_position = c
	var out: Array = []
	out.resize(bots.size())
	out.fill(-1.0)
	var t := 0.0
	while t < 40.0 and out.has(-1.0):
		game.time_left = T.MATCH_TIME
		game.score = [0, 0]
		await tree.physics_frame
		t += 1.0 / 60.0
		for i in bots.size():
			if out[i] < 0.0 and game.slab.contains(bots[i].global_position):
				out[i] = t
	game.pets = keep
	for b in bots:
		b.queue_free()
	return out

func _data(game: Node) -> Dictionary:
	return (game.get_script() as Script).get_script_constant_map()

## The trip match.gd keeps beside this slot, or -1.
func _data_trip(game: Node, data: Dictionary, team: int, at: Vector3, label: String) -> float:
	if team == 1:
		var slots: Dictionary = data.get("CAT_SLOTS", {})
		var kind := "start" if label.begins_with("start") else "respawn"
		for e in slots.get(kind, []):
			if absf(float(e.x) - at.x) < 0.3 and absf(float(e.z) - at.z) < 0.3:
				return float(e.trip)
		return -1.0
	var trips: Dictionary = data.get("CORGI_TRIPS", {})
	if label.begins_with("start"):
		var k := int(label.right(1))
		var st: Array = trips.get("start", [])
		return float(st[k]) if k < st.size() else -1.0
	var rs: Array = trips.get("respawn", [])
	for j in mini(rs.size(), game.respawn_slots[0].size()):
		var q: Vector3 = game.respawn_slots[0][j]
		if Vector2(q.x - at.x, q.z - at.z).length() < 0.3:
			return float(rs[j])
	return -1.0

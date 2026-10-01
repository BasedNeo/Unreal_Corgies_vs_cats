extends RefCounted
## G-MOVE (W14): a respawn costs both teams the same trip back to the slab.
## 1. In a 2v2 (the human and a Corgi bot against two Cat bots, bots frozen), ROUNDS rounds each place the living pets
##    somewhere on the map (the slab, either half, either base) and down one pet of each team in the same tick, by
##    turns the human + Cat bot 1 and the Corgi bot + Cat bot 2, then all four together. Every respawn point's
##    straight-line sprint time to the slab (distance / the species' sprint, tuning.gd) must be within BAND s of every
##    respawn of the other team, and two pets of a team that respawn together must not share a point. Prints the mean
##    distance and sprint time per team (docs/qa/w14/respawn.md has W13 against W14).
## 2. A Player pet of each team's species, from every distinct respawn point seen, presses only move_forward (then
##    move_forward + sprint) and must reach the slab like test_game_stepup.gd's runners (same helper: straight-line
##    time + 30 %, no stall of 0.5 s).
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Player := preload("res://game/player.gd")
const Stepup := preload("res://tests/test_game_stepup.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const BAND := 0.3
const ROUNDS := 8
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
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var corgis: Array = game.pets.filter(func(p): return p.team == 0)  # [the human, the Corgi bot]
	var cats: Array = game.pets.filter(func(p): return p.team == 1)
	var c: Vector3 = game.slab.center
	var seen := [[], []]  # [point, sprint time, distance] per respawn
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
			var dist := Vector2(at.x - c.x, at.z - c.z).length()
			var row := [at, dist / float(T.MOVE[p.team].sprint), dist]
			got[p.team].append(row)
			seen[p.team].append(row)
		for t in 2:
			if got[t].size() == 2 and (got[t][0][0] as Vector3).distance_to(got[t][1][0]) < 1.0:
				errs.append("round %d: both %s respawned on one point" % [k, ["Corgis", "Cats"][t]])
	for t in 2:
		var n: int = seen[t].size()
		var dsum := 0.0
		var tsum := 0.0
		var tmin := INF
		var tmax := -INF
		for row in seen[t]:
			dsum += row[2]
			tsum += row[1]
			tmin = minf(tmin, row[1])
			tmax = maxf(tmax, row[1])
		print("  respawn %s: n %d, mean %.1f m, mean sprint %.2f s (%.2f-%.2f s)" % [["Corgi", "Cat"][t], n,
			dsum / maxf(1, n), tsum / maxf(1, n), tmin, tmax])
	var worst := 0.0
	for a in seen[0]:
		for b in seen[1]:
			worst = maxf(worst, absf(a[1] - b[1]))
	print("  respawn: largest Corgi-Cat sprint-time gap over all respawns %.2f s" % worst)
	if worst > BAND:
		errs.append("a Corgi and a Cat respawn differ by %.2f s of sprint to the slab (want <= %.2f)" % [worst, BAND])
	# 2. walk back from every distinct respawn point
	for p in game.pets:
		p.set_physics_process(false)  # the 2v2 stands aside; the human must not run with the runners
	var runners: Array = []
	var starts := {}
	for t in 2:
		var pts: Array = []
		for row in seen[t]:
			var dup := false
			for q in pts:
				dup = dup or Vector2(q.x - row[0].x, q.z - row[0].z).length() < 0.5
			if not dup:
				pts.append(row[0])
		for at in pts:
			var r: Node = Player.new()
			r.configure(t, t, "%s from the respawn at (%.1f, %.1f)" % [["Corgi", "Cat"][t], at.x, at.z], game.look)
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

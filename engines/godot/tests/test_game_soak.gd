extends RefCounted
## G-GAME: a 60 s (game time) 2v2 bot-vs-bot soak on whatever world is present: no engine or script errors, the
## score changes, bots travel (none stuck at spawn), and the physics tick cost is printed. Runs at 4x speed with
## 240 physics ticks per real second, so every tick still steps 1/60 s.
const Kit := preload("res://game/testkit.gd")
const SOAK := 60.0
const SPEED := 4.0

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": false, "allies": 1, "enemies": 2, "think": true})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.pets.size() != 4:
		errs.append("2v2 bot match did not start")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	var start := {}
	var travel := {}
	for p in game.pets:
		start[p] = p.global_position
		travel[p] = 0.0
	var downs := [0]
	game.pet_down.connect(func(_p, _k): downs[0] += 1)
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var shots := [0]
	for p in game.pets:
		p.rifle.fired.connect(func(_r): shots[0] += 1)
	var t_real := Time.get_ticks_msec()
	var cost: PackedFloat32Array = []
	var last := {}
	for p in game.pets:
		last[p] = p.global_position
	while game.elapsed < SOAK and game.playing() and Time.get_ticks_msec() - t_real < SOAK * 1000.0 / SPEED * 3.0:
		await tree.physics_frame
		cost.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
		for p in game.pets:
			travel[p] += Vector2(p.global_position.x - last[p].x, p.global_position.z - last[p].z).length()
			last[p] = p.global_position
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	var real_s := (Time.get_ticks_msec() - t_real) / 1000.0
	cost.sort()
	var avg := 0.0
	for v in cost:
		avg += v
	avg /= maxf(1.0, cost.size())
	print("  soak: %.1f s game in %.1f s real · score %d-%d · %d takedowns · %d shots · slab %s · TIME_PHYSICS_PROCESS (per-second max, 4x) avg %.3f ms p95 %.3f ms" % [
		game.elapsed, real_s, game.score[0], game.score[1], downs[0], shots[0], str(game.slab_state.counts), avg,
		cost[int(cost.size() * 0.95)] if cost.size() > 0 else 0.0])
	if game.elapsed < SOAK and game.playing():
		errs.append("soak reached only %.1f s of game time" % game.elapsed)
	if game.score[0] + game.score[1] == 0:
		errs.append("no score change in %.0f s of bot play" % game.elapsed)
	if shots[0] == 0:
		errs.append("no bot fired a shot")
	for p in game.pets:
		if travel[p] < 5.0:
			errs.append("%s travelled only %.1f m (stuck?)" % [p.display_name, travel[p]])
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

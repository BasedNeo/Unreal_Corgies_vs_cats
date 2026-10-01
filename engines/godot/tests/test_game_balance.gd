extends RefCounted
## G-BOT (W13): fast checks behind the balance numbers in docs/handoff/G-BOT.md (the full harness, which plays whole
## matches, is tests/balance.gd and is not part of this run).
## 1. A bot's ledge jump is not below the step-up: a path corner a pet can step onto (pet.gd STEP_HEIGHT) needs no jump.
## 2. Travel gait: in a bots-only 1v1 both bots leave their spawns at their species' sprint speed (nobody in sight,
##    the slab far away): the Corgi 9.6 m/s, the Cat 8.8 m/s, the Corgi's counterweight to the Cat's faster run
##    (6.6 vs 6.4 m/s). A bot that only ran gave the Cat the faster trip from every respawn (the 2v2 lean).
## 3. A bot with an enemy in sight runs (its spread grows with speed up to the run speed; it does not sprint at a fight).
## 4. On the slab a bot's wish keeps it bot.gd SLAB_MARGIN m inside the edges (W14): heading out from the edge band it
##    turns back in; in the middle it is left alone.
const Kit := preload("res://game/testkit.gd")
const Bot := preload("res://game/bot.gd")
const Pet := preload("res://game/pet.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const LEAVE := 4.0  # game seconds watched from the match start

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var bc: Dictionary = (Bot as Script).get_script_constant_map()
	var step: float = (Pet as Script).get_script_constant_map().get("STEP_HEIGHT", 0.45)
	if float(bc.get("LEDGE_JUMP", 0.0)) < step - 1e-6:
		errs.append("bot.gd LEDGE_JUMP %.2f m is below pet.gd STEP_HEIGHT %.2f m: the bot jumps at kerbs it can step onto" % [
			float(bc.get("LEDGE_JUMP", 0.0)), step])
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": false, "allies": 0, "enemies": 1, "think": true})
	var game: Node = main.get_node("Game")
	for i in 600:
		if game.nav_ready():
			break
		await tree.physics_frame
	if not game.playing() or game.pets.size() != 2 or not game.nav_ready():
		errs.append("bots-only 1v1 did not start with a ready nav map")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	game.start_match()
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var top := {}
	for p in game.pets:
		top[p] = 0.0
	while game.elapsed < LEAVE and game.playing():
		await tree.physics_frame
		for p in game.pets:
			top[p] = maxf(top[p], Vector2(p.velocity.x, p.velocity.z).length())
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	for p in game.pets:
		var want: float = p.m.sprint
		print("  %s: top speed %.2f m/s in the first %.0f s (sprint %.1f, run %.1f)" % [p.display_name, top[p], LEAVE, want, p.m.run])
		if top[p] < want - 0.3:
			errs.append("%s topped out at %.2f m/s leaving its spawn; want its sprint, %.1f m/s" % [p.display_name, top[p], want])
	var a: Node = game.pets[0]
	var b: Node = game.pets[1]
	a.target = b
	a.target_visible = true
	if not a.has_method("_gait"):
		errs.append("bot.gd has no _gait(): bots have a single gait")
	elif not is_equal_approx(a._gait(), float(a.m.run)):
		errs.append("%s with an enemy in sight moves at %.1f m/s, not its run %.1f" % [a.display_name, a._gait(), a.m.run])
	if not a.has_method("_hold_inside"):
		errs.append("bot.gd has no _hold_inside(): nothing keeps a holding bot off the slab's edge")
	else:
		var c: Vector3 = game.slab.center
		var edge: float = game.slab.size.x * 0.5
		var band: Vector3 = a._hold_inside(Vector3(1, 0, 0), c + Vector3(edge - 0.5, 0, 0))
		var mid: Vector3 = a._hold_inside(Vector3(1, 0, 0), c)
		if band.x >= 0.0:
			errs.append("a bot 0.5 m from the slab's edge, heading out, keeps going out (wish x %.2f)" % band.x)
		if not mid.is_equal_approx(Vector3(1, 0, 0)):
			errs.append("a bot in the middle of the slab had its wish changed to %s" % str(mid))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

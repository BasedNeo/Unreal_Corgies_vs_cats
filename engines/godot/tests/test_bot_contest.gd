extends RefCounted
## G-BOT (W15 CONTEST GUARD): bots holding and contesting the slab stay off its edge.
## The four bots of a 2v2 stand on the slab, two per side, and fight there for HOLD_S s of game time. Everyone is kept
## unhurt (shield), so the fight never ends and nobody walks back from a spawn. Over every tick a bot is on the slab
## (slab.gd contains()), the share it spends in the edge band, inside the score volume but less than
## bot.gd SLAB_MARGIN (1 m) from an edge, must stay at or under MAX_BAND. And the bots must stay on the slab: at least
## MIN_ON of their time (76 of the 80 pet-s), so a bot that walks off a contested slab fails the test too.
## The 17 % and 1 % in docs/handoff/G-BOT.md section 11 are the --holder scenario (tests/balance.gd --holder 40 --n
## 10: one Cat bot attacks an idle, unhurt Corgi in the slab's middle): W13's bot spent 17 % of its time there in the
## edge band, and W14 CONTEST (bot.gd _hold_inside()) brought it to 1 %. This test is a different scenario, four bots
## fighting on the slab: 0.2-0.9 % shipped over ten runs. Without _hold_inside(), or with the margin set to 0, it fails
## (docs/qa/w15/bot-roles.md has ten runs of each).
const Kit := preload("res://game/testkit.gd")
const SPEED := 4.0  # 240 physics ticks per real second: every tick still steps 1/60 s
const HOLD_S := 20.0
const MAX_BAND := 0.05
const MIN_ON := 0.95  # of the pets' time on the slab: 76 of 80 pet-s (shipped: 80.0)
const EDGE := 1.0  # the band's width, m (bot.gd SLAB_MARGIN at W14)
## Where the bots stand when the fight starts, from the slab's centre (x, z): Corgis on one side, Cats on the other.
const PLACES := [[[-2.0, -2.5], [2.0, -2.5]], [[-2.0, 2.5], [2.0, 2.5]]]

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
	game.start_match()
	var c: Vector3 = game.slab.center
	var used := [0, 0]
	for p in game.pets:
		var at: Array = PLACES[p.team][used[p.team]]
		used[p.team] += 1
		var hit: Dictionary = game._ground_hit(c + Vector3(at[0], 0.0, at[1]))
		var pos: Vector3 = (hit.position if not hit.is_empty() else c + Vector3(at[0], 0.0, at[1])) + Vector3(0, 0.05, 0)
		p.respawn(pos, game._yaw_to(pos, c))
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var on := 0.0
	var band := 0.0
	var per := {}
	for p in game.pets:
		per[p] = [0.0, 0.0]
	var t := 0.0
	var dt := 1.0 / 60.0
	while t < HOLD_S and game.playing():
		for p in game.pets:
			p.shield = 1.0  # unhurt: the fight goes on
		game.score = [0, 0]
		game.time_left = 180.0
		await tree.physics_frame
		t += dt
		for p in game.pets:
			if not p.alive or not game.slab.contains(p.global_position):
				continue
			on += dt
			per[p][0] += dt
			var rel := Vector2(p.global_position.x - c.x, p.global_position.z - c.z)
			var h: Vector2 = game.slab.size * 0.5
			if absf(rel.x) > h.x - EDGE or absf(rel.y) > h.y - EDGE:
				band += dt
				per[p][1] += dt
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	var share := band / maxf(on, 1e-6)
	var parts: Array = []
	for p in game.pets:
		parts.append("%s %.1f/%.1f s" % [p.display_name, per[p][1], per[p][0]])
	print("  contest: %.0f s of game, %.1f pet-s on the slab, %.2f pet-s in the 1 m edge band: %.1f %% (max %.0f %%) · %s" % [
		t, on, band, 100.0 * share, 100.0 * MAX_BAND,
		", ".join(parts)])
	var floor_on: float = MIN_ON * game.pets.size() * HOLD_S
	if on < floor_on:
		errs.append("the bots stood on the slab only %.1f pet-s in %.0f s (min %.0f): a bot left the slab" % [on, t,
			floor_on])
	if share > MAX_BAND:
		errs.append("bots spent %.1f %% of their slab time within %.0f m of an edge (max %.0f %%)" % [100.0 * share, EDGE,
			100.0 * MAX_BAND])
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

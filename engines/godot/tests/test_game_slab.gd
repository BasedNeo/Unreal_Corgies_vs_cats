extends RefCounted
## G-GAME: slab scoring ticks 1 point per second when one team holds it alone, and does not tick when contested.
const Kit := preload("res://game/testkit.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.pets.size() != 2:
		errs.append("match did not start with one pet per team")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	var corgi: Node = game.pets[0]
	var cat: Node = game.pets[1]
	for p in game.pets:
		p.set_physics_process(false)  # hold them where the test puts them
	var c: Vector3 = game.slab.center
	var far := c + Vector3(0, 0, 60)
	# no awaits below: the match's own tick does not run between these direct steps
	var s0: Array = game.score.duplicate()
	corgi.global_position = c
	cat.global_position = far
	for i in 3:
		game.step_score(1.0)
	if game.score[0] != s0[0] + 3 or game.score[1] != s0[1]:
		errs.append("held alone for 3 s: score %s, expected [%d, %d]" % [str(game.score), s0[0] + 3, s0[1]])
	if int(game.slab_state.holder) != 0 or game.slab_state.contested:
		errs.append("slab state while the Corgi holds it: %s" % str(game.slab_state))
	game.step_score(0.5)
	game.step_score(0.5)
	if game.score[0] != s0[0] + 4:
		errs.append("half seconds do not add up to a point (score %s)" % str(game.score))
	var s1: Array = game.score.duplicate()
	cat.global_position = c + Vector3(1.5, 0, 1.5)
	for i in 4:
		game.step_score(1.0)
	if game.score != s1:
		errs.append("contested slab still scored: %s -> %s" % [str(s1), str(game.score)])
	if not game.slab_state.contested:
		errs.append("slab not reported contested with both teams on it: %s" % str(game.slab_state))
	corgi.global_position = far
	for i in 2:
		game.step_score(1.0)
	if game.score[1] != s1[1] + 2 or game.score[0] != s1[0]:
		errs.append("Cat alone for 2 s: score %s, expected [%d, %d]" % [str(game.score), s1[0], s1[1] + 2])
	corgi.die(null)  # a downed pet does not hold or contest
	corgi.global_position = c
	game.step_score(1.0)
	if game.score[1] != s1[1] + 3:
		errs.append("a downed Corgi on the slab blocked the Cat's point")
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

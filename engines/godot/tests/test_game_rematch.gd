extends RefCounted
## G-GAME: the winner screen, then the rematch action resets the score, the timer and every pet. The same action
## during play does nothing. First to 60 ends the match.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing():
		errs.append("match did not start")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	# rematch is ignored mid-match
	game.score = [5, 3]
	Input.action_press("rematch")
	await tree.process_frame
	await tree.process_frame
	Input.action_release("rematch")
	if game.score != [5, 3] or not game.playing():
		errs.append("rematch action changed a running match (score %s)" % str(game.score))
	# first to 60 wins
	game.score = [59, 41]
	game.hold_acc = 0.0
	for p in game.pets:
		p.set_physics_process(false)
	game.pets[1].global_position = game.slab.center + Vector3(0, 0, 60)
	game.player.global_position = game.slab.center
	game.step_score(1.0)
	await Kit.physics(tree, 2)  # physics_frame fires before the nodes tick: two frames = one match tick done
	if not game.over() or game.winner != 0:
		errs.append("reaching %d did not end the match for the Corgis (state %d, winner %d)" % [T.WIN_SCORE, game.state, game.winner])
	game.player.die(null)
	game.time_left = 12.0
	await tree.process_frame
	if not game.hud._winner.visible:
		errs.append("winner screen not shown")
	Input.action_press("rematch")
	await tree.process_frame
	await tree.process_frame
	Input.action_release("rematch")
	if not game.playing():
		errs.append("rematch did not restart the match")
	if game.score != [0, 0]:
		errs.append("rematch did not reset the score: %s" % str(game.score))
	if game.time_left < T.MATCH_TIME - 0.2:
		errs.append("rematch did not reset the timer: %.2f" % game.time_left)
	if game.winner != -1 or game.overtime:
		errs.append("rematch left winner %d / overtime %s" % [game.winner, game.overtime])
	for p in game.pets:
		if not p.alive or p.hp < T.MAX_HP:
			errs.append("%s not back at full health after the rematch" % p.display_name)
	# the clock: time runs out with a lead -> the leader wins; tied -> overtime
	game.score = [3, 7]
	game.time_left = 0.01
	await Kit.physics(tree, 2)
	if not game.over() or game.winner != 1:
		errs.append("time out with the Cats ahead did not give them the win (winner %d)" % game.winner)
	game.rematch()
	game.score = [4, 4]
	game.time_left = 0.01
	for p in game.pets:
		p.global_position = game.slab.center + Vector3(0, 0, 60 if p.team == 0 else -60)
	await Kit.physics(tree, 2)
	if not game.overtime or not game.playing():
		errs.append("a tie at 0:00 did not go to overtime")
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

extends RefCounted
## G-GAME: a pressed move action moves the player, releasing it stops them (no drift, no auto-walk), a reverse
## input turns the velocity round quickly, and jump leaves the ground.
const Kit := preload("res://game/testkit.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 0})
	var game: Node = main.get_node("Game")
	var p: Node = game.player
	if not game.playing() or p == null:
		errs.append("match did not start with a player")
		errs.append_array(Kit.unwatch(log))
		await Kit.dispose(tree, main)
		return errs
	await Kit.physics(tree, 40)  # land on the ground
	if not p.is_on_floor():
		errs.append("player is not on the floor after spawning (y=%.2f)" % p.global_position.y)
	var start: Vector3 = p.global_position
	var idle := Vector2(p.velocity.x, p.velocity.z).length()
	if idle > 0.001:
		errs.append("player walks with no input (%.3f m/s)" % idle)
	Input.action_press("move_forward")
	await Kit.physics(tree, 30)  # 0.5 s
	var moved := Vector2(p.global_position.x - start.x, p.global_position.z - start.z).length()
	if moved < 2.0:
		errs.append("move_forward for 0.5 s moved the player only %.2f m" % moved)
	var v_fwd := Vector2(p.velocity.x, p.velocity.z)
	if absf(v_fwd.length() - float(p.m.run)) > 0.05:
		errs.append("run speed %.2f m/s, expected %.2f (TS runSpeed)" % [v_fwd.length(), p.m.run])
	Input.action_release("move_forward")
	await Kit.physics(tree, 15)  # 0.25 s; ground decel 50 m/s^2 stops 6.4 m/s in 0.13 s
	var hs := Vector2(p.velocity.x, p.velocity.z).length()
	if hs > 0.001:
		errs.append("still moving %.3f m/s 0.25 s after release" % hs)
	var rest: Vector3 = p.global_position
	await Kit.physics(tree, 30)
	if p.global_position.distance_to(rest) > 0.005:
		errs.append("player drifted %.3f m after stopping" % p.global_position.distance_to(rest))
	# reverse cleanly
	Input.action_press("move_forward")
	await Kit.physics(tree, 20)
	var v1 := Vector2(p.velocity.x, p.velocity.z)
	Input.action_release("move_forward")
	Input.action_press("move_back")
	await Kit.physics(tree, 15)  # 0.25 s
	var v2 := Vector2(p.velocity.x, p.velocity.z)
	Input.action_release("move_back")
	if v1.dot(v2) >= 0.0 or v2.length() < 4.0:
		errs.append("reverse did not turn the velocity round in 0.25 s (%s -> %s)" % [v1, v2])
	await Kit.physics(tree, 30)
	# jump
	var y0: float = p.global_position.y
	Input.action_press("jump")
	var peak := y0
	for i in 30:
		await tree.physics_frame
		peak = maxf(peak, p.global_position.y)
	Input.action_release("jump")
	if peak - y0 < 1.0:
		errs.append("jump rose only %.2f m" % (peak - y0))
	await Kit.physics(tree, 60)
	if not p.is_on_floor():
		errs.append("player did not land after the jump")
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

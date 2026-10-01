extends RefCounted
## G-MOVE (W13): the proof options.
## --demo: the human starts within NEAR m of the slab's edge, and comes back there after being downed in that first
##   match (at W12 the human started 6 m off the edge, the Cat bot downed them 2-3 s in, and the respawn sent them
##   to the team spawn 120-140 m away: what Q6 saw). A rematch, and a match without --demo, start at the team spawn.
## --lineup M: the human stands M m from the slab centre on open ground, facing it, in the play camera with a clear
##   line to both bots, the crosshair about 1.5 m over them; a Corgi bot and a Cat bot stand still on the slab side by
##   side, facing the human (or, with --lineup-side, side on to the camera and a body length apart), and fire nothing;
##   the HUD is up.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const NEAR := 3.0

static func off_slab(game: Node, p: Vector3) -> float:
	var c: Vector3 = game.slab.center
	var s: Vector2 = game.slab.size
	return Vector2(maxf(0.0, absf(p.x - c.x) - s.x * 0.5), maxf(0.0, absf(p.z - c.z) - s.y * 0.5)).length()

static func facing_err(yaw: float, from: Vector3, to: Vector3) -> float:
	var f := Vector2(-sin(yaw), -cos(yaw))
	return rad_to_deg(f.angle_to(Vector2(to.x - from.x, to.z - from.z)))

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	errs.append_array(await _demo(tree))
	errs.append_array(await _normal(tree))
	errs.append_array(await _lineup(tree, 30.0, false))
	errs.append_array(await _lineup(tree, 30.0, true))
	errs.append_array(Kit.unwatch(log))
	return errs

func _demo(tree: SceneTree) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": true, "demo": true})
	var game: Node = main.get_node("Game")
	var p: Node = game.player
	if not game.playing() or p == null or game.pets.size() != 2:
		errs.append("--demo: match did not start with the human and a Cat bot")
		await Kit.dispose(tree, main)
		return errs
	var d0 := off_slab(game, p.global_position)
	print("  --demo: the human starts %.1f m off the slab's edge" % d0)
	if d0 > NEAR:
		errs.append("--demo: the human starts %.1f m off the slab's edge (want <= %.1f)" % [d0, NEAR])
	if absf(facing_err(p.cam_yaw, p.global_position, game.slab.center)) > 3.0:
		errs.append("--demo: the human does not face the slab")
	# downed in the first match: the respawn must bring them back beside the slab, not to the team spawn
	p.die(game.pets[1])
	var waited := 0
	while not p.alive and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
		await tree.physics_frame
		waited += 1
	var d1 := off_slab(game, p.global_position)
	print("  --demo: after a takedown the human comes back %.1f m off the slab's edge" % d1)
	if not p.alive:
		errs.append("--demo: the human did not respawn")
	elif d1 > NEAR:
		errs.append("--demo: after a takedown the human came back %.1f m off the slab's edge (the team spawn?)" % d1)
	# a rematch is a normal match
	game.end_match(1)
	game.rematch()
	var home: Vector3 = game.spawns[0][0]
	if p.global_position.distance_to(home) > 1.0:
		errs.append("--demo: the rematch did not start the human at the team spawn (%.1f m from it)" % p.global_position.distance_to(home))
	await Kit.dispose(tree, main)
	return errs

func _normal(tree: SceneTree) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	var p: Node = game.player
	if p == null or not game.playing():
		errs.append("normal match did not start with the human")
	elif p.global_position.distance_to(game.spawns[0][0]) > 1.0:
		errs.append("normal match: the human starts %.1f m from the team spawn" % p.global_position.distance_to(game.spawns[0][0]))
	await Kit.dispose(tree, main)
	return errs

func _lineup(tree: SceneTree, dist: float, side_on: bool) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"lineup": dist, "lineup_side": side_on})
	var game: Node = main.get_node("Game")
	var p: Node = game.player
	var bots: Array = game.pets.filter(func(b): return b != p)
	if p == null or not game.playing() or bots.size() != 2 or bots[0].team == bots[1].team:
		errs.append("--lineup: match did not start with the human, a Corgi bot and a Cat bot")
		await Kit.dispose(tree, main)
		return errs
	var shots := [0]
	for b in bots:
		b.rifle.fired.connect(func(_r): shots[0] += 1)
	var c: Vector3 = game.slab.center
	var at := {}
	for b in bots:
		at[b] = b.global_position
	await Kit.physics(tree, 120)  # 2 s: the bots must stay put and hold fire
	var pos: Vector3 = p.global_position
	var r := Vector2(pos.x - c.x, pos.z - c.z).length()
	print("  --lineup %.0f%s: the human at (%.1f, %.2f, %.1f), %.2f m from the slab centre; bots at %s" % [
		dist, " --lineup-side" if side_on else "", pos.x, pos.y, pos.z, r, str(bots.map(func(b): return b.global_position.snapped(Vector3.ONE * 0.01)))])
	if absf(r - dist) > 0.5:
		errs.append("--lineup: the human is %.2f m from the slab centre, want %.1f" % [r, dist])
	if absf(pos.y - c.y) > 1.0 or not p.is_on_floor():
		errs.append("--lineup: the human is not on open ground near the slab's level (y %.2f, floor %s)" % [pos.y, p.is_on_floor()])
	if absf(facing_err(p.cam_yaw, pos, c)) > 3.0:
		errs.append("--lineup: the camera does not face the slab (%.1f deg off)" % facing_err(p.cam_yaw, pos, c))
	if not p.camera.current:
		errs.append("--lineup: the shot is not from the play camera")
	var space: PhysicsDirectSpaceState3D = p.get_world_3d().direct_space_state
	for b in bots:
		if not game.slab.contains(b.global_position):
			errs.append("--lineup: %s is not on the slab" % b.display_name)
		if b.global_position.distance_to(at[b]) > 0.05:
			errs.append("--lineup: %s moved %.2f m" % [b.display_name, b.global_position.distance_to(at[b])])
		var fe := absf(facing_err(b.yaw, b.global_position, pos))
		if side_on and absf(fe - 90.0) > 3.0:
			errs.append("--lineup-side: %s is not side on to the human (%.1f deg off the line to them)" % [b.display_name, fe])
		elif not side_on and fe > 3.0:
			errs.append("--lineup: %s does not face the human (%.1f deg off)" % [b.display_name, fe])
		var q := PhysicsRayQueryParameters3D.create(p.camera.global_position, b.chest(), T.L_WORLD)
		if not space.intersect_ray(q).is_empty():
			errs.append("--lineup: the camera has no clear line to %s" % b.display_name)
	var apart: float = bots[0].global_position.distance_to(bots[1].global_position)
	if apart > (3.5 if side_on else 3.0) or (side_on and apart < 2.4):
		errs.append("--lineup: the bots stand %.2f m apart" % apart)
	# the crosshair (the camera's forward ray) passes 1-2.5 m over the slab, so it and the SLAB marker clear the bots
	var cam: Camera3D = p.camera
	var fwd := -cam.global_basis.z
	var t := Vector2(c.x - cam.global_position.x, c.z - cam.global_position.z).length() / maxf(Vector2(fwd.x, fwd.z).length(), 1e-3)
	var over: float = cam.global_position.y + fwd.y * t - c.y
	if over < 1.0 or over > 2.5:
		errs.append("--lineup: the crosshair passes %.2f m over the slab centre (want 1-2.5)" % over)
	if shots[0] > 0:
		errs.append("--lineup: the bots fired %d shots" % shots[0])
	if game.hud == null or not game.hud.visible:
		errs.append("--lineup: the HUD is not up")
	await Kit.dispose(tree, main)
	return errs

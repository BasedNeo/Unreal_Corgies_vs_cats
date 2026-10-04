extends RefCounted
## W15 G-HUD: a fall off The Lot. match.gd downs a living pet whose feet drop more than 40 m below the slab's ground
## (`_ground_y`, set from the slab's centre: the plane is slab.center.y - 40). A 1v1 with the human; the pets' own
## physics is off, so each stays exactly where the test puts it while the match ticks:
## - at 39.5 m below: nothing happens (still up, nobody's tally moves, no feed line);
## - at 40.5 m below: it is downed with no killer and no credit (its deaths + 1, nobody's takedowns), the feed reads
##   `The Lot  >  <name>` with no team, and its respawn countdown starts at about RESPAWN_TIME;
## - the local player's fall reads TAKEN DOWN BY THE LOT on the death panel, with no glyph.
## Checked for the Cat bot and for the human.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("1v1 with the human did not start")
	else:
		for p in game.pets:
			p.set_physics_process(false)
		for p in [game.pets[1], game.player]:
			errs.append_array(await _fall(tree, game, p))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

func _fall(tree: SceneTree, game: Node, pet: Node) -> Array:
	var e: Array = []
	var c: Vector3 = game.slab.center
	var name: String = pet.display_name
	var tally := {}
	for p in game.pets:
		tally[p] = [p.kills, p.deaths]
	var feed0: int = game.feed.size()
	# just above the plane: nothing
	pet.global_position = Vector3(c.x + 30.0, c.y - 39.5, c.z + 30.0)
	await Kit.physics(tree, 6)
	if not pet.alive or game.feed.size() != feed0 or pet.deaths != tally[pet][1]:
		e.append("%s 39.5 m below the slab's ground was downed (alive %s, feed %s)" % [name, pet.alive, str(game.feed)])
	# just below it: downed by the map
	pet.global_position = Vector3(c.x + 30.0, c.y - 40.5, c.z + 30.0)
	await Kit.physics(tree, 2)
	if pet.alive:
		e.append("%s 40.5 m below the slab's ground is still up" % name)
		return e
	if pet.deaths != tally[pet][1] + 1:
		e.append("%s's knockouts went %d -> %d, want +1" % [name, tally[pet][1], pet.deaths])
	for p in game.pets:
		if p.kills != tally[p][0]:
			e.append("%s's fall credited %s with a takedown (%d -> %d)" % [name, p.display_name, tally[p][0], p.kills])
	var line: Dictionary = game.feed.back() if not game.feed.is_empty() else {}
	if game.feed.size() != feed0 + 1 or line.get("text", "") != "The Lot  >  %s" % name or int(line.get("team", 0)) != -1:
		e.append("%s's fall: the feed reads %s, want one new line 'The Lot  >  %s' with no team" % [name, str(line), name])
	var left: float = game.respawn_left(pet)
	if absf(left - T.RESPAWN_TIME) > 0.1:
		e.append("%s's fall: respawn in %.2f s, want about %.1f" % [name, left, T.RESPAWN_TIME])
	if pet == game.player:
		await tree.process_frame
		await tree.process_frame
		var hud: Node = game.hud
		if hud.death_text.is_empty() or hud.death_text[0] != "TAKEN DOWN BY THE LOT" or hud._death_glyph.is_visible_in_tree():
			e.append("the player's fall: the death panel reads %s (glyph shown %s), want TAKEN DOWN BY THE LOT, no glyph" % [
				str(hud.death_text), hud._death_glyph.is_visible_in_tree()])
	# back up for the next pet
	var waited := 0
	while not pet.alive and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
		await tree.physics_frame
		waited += 1
	if not pet.alive:
		e.append("%s did not respawn after the fall" % name)
	return e

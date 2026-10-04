extends RefCounted
## G-GAME: the winner screen, then the rematch action resets the score, the timer and every pet. The same action
## during play does nothing. First to 60 ends the match.
## W15 G-HUD (contract §5, Rematch): the real R key, then the real Enter key (key events through Input, as the
## InputMap binds them), each pressed on the winner screen of a match that ended mid-cue and mid-death:
## - R: the player had just downed the Cat bot (a kill confirm) and taken a hit (a wedge, the red flash, the HP chip);
## - Enter: the Cat bot had just taken the player down (the death panel and its countdown were up), with the kill
##   confirm and the killing hit's wedge, flash and chip still running.
## After the rematch: score 0 - 0, no respawn countdown left (respawn_left 0), the clock at 3:00, every pet at its start
## slot, and nothing left on the HUD: no
## confirm, wedge, chip, red flash, death panel or winner screen, and an empty takedown feed. (The bots' own state is
## g-bot's, tests/test_bot_roles.gd; this checks only what the player sees.)
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
	game.rematch()
	errs.append_array(await _rematch_clears(tree, game, KEY_R, false))
	errs.append_array(await _rematch_clears(tree, game, KEY_ENTER, true))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## A real key event (physical keycode), down or up, through Input: what a keyboard sends.
static func key(k: Key, down: bool) -> void:
	var e := InputEventKey.new()
	e.physical_keycode = k
	e.keycode = k
	e.pressed = down
	Input.parse_input_event(e)

## §5: end a match mid-cue (and, with `dead`, mid-death), press `k` on the winner screen, and check that the new match
## starts clean.
func _rematch_clears(tree: SceneTree, game: Node, k: Key, dead: bool) -> Array:
	var e: Array = []
	var tag := "%s rematch%s" % [OS.get_keycode_string(k), " mid-death" if dead else " mid-cue"]
	var hud: Node = game.hud
	var me: Node = game.player
	var cat: Node = game.pets.filter(func(p): return p != me)[0]
	cat.set_physics_process(false)
	await Kit.physics(tree, 3)
	cat.global_position = me.global_position + Vector3(6, 0, 0)
	me.shield = 0.0
	if dead:
		me.take_damage(float(T.MAX_HP) + 10.0, cat)  # the killing hit: wedge, flash, chip, then the death panel
	else:
		me.take_damage(15.0, cat)  # a wedge, the flash, the chip
		cat.die(me)  # the player's takedown: in the feed
	me.hit_confirmed.emit({"kill": true, "head": false, "hit": true, "target": cat, "pos": cat.global_position, "damage": 15.0})
	await tree.process_frame
	await tree.process_frame
	# the cues are up (the precondition: otherwise this test proves nothing)
	var up := {"confirm": hud.hit_t > 0.0, "wedge": hud.wedges.size() == 1, "flash": hud._flash.color.a > 0.0,
		"chip": hud._chip.visible, "feed": not game.feed.is_empty()}
	if dead:
		up["death panel"] = hud._death.visible and hud.death_text.size() == 4 and hud.death_text[3].begins_with("BACK IN ")
	for cue in up:
		if not up[cue]:
			e.append("%s: setup, the %s is not up before the match ends" % [tag, cue])
	game.score = [12, T.WIN_SCORE]
	game.end_match(1)
	await tree.process_frame
	await tree.process_frame
	if not hud._winner.visible:
		e.append("%s: setup, the winner screen is not up" % tag)
	key(k, true)
	await tree.process_frame  # the rematch runs in this frame's _process, the HUD after it
	await tree.process_frame
	key(k, false)
	if not game.playing():
		e.append("%s: the match did not restart" % tag)
		return e
	if game.score != [0, 0]:
		e.append("%s: score %s, want [0, 0]" % [tag, str(game.score)])
	if game.respawn_left(me) != 0.0:
		e.append("%s: the player's respawn countdown is still %.2f s after the rematch, want 0" % [tag, game.respawn_left(me)])
	if game.time_left < T.MATCH_TIME - 0.2 or hud._timer.text != "3:00":
		e.append("%s: the clock reads %s (%.2f s left), want 3:00" % [tag, hud._timer.text, game.time_left])
	var used := [0, 0]
	var slots := [game.start_slots(0), game.start_slots(1)]
	for p in game.pets:
		var list: Array = slots[p.team]
		var sp: Vector3 = list[used[p.team] % list.size()] + Vector3(1.2 * floorf(float(used[p.team]) / list.size()), 0, 0)
		used[p.team] += 1
		var at: Vector3 = p.global_position
		if Vector2(at.x - sp.x, at.z - sp.z).length() > 0.3 or absf(at.y - sp.y) > 0.6 or not p.alive:
			e.append("%s: %s is at %s (alive %s), not at its start slot %s" % [tag, p.display_name, str(at), p.alive, str(sp)])
	var left := {"confirm": hud.hit_t > 0.0, "wedge": not hud.wedges.is_empty(), "red flash": hud._flash.color.a > 0.0,
		"HP chip": hud._chip.visible, "death panel": hud._death.visible or not hud.death_text.is_empty(),
		"remembered killer": not hud.down_by.is_empty(), "winner screen": hud._winner.visible,
		"takedown feed": not game.feed.is_empty() or hud._feed.text != ""}
	var drawn: Array = hud.overlay_prims().map(func(it): return it.what)
	left["drawn confirm"] = drawn.has("confirm")
	left["drawn wedge"] = drawn.has("wedge")
	for cue in left:
		if left[cue]:
			e.append("%s: the %s is still there after the rematch" % [tag, cue])
	return e

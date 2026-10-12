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
## W17 X3 (G-REMATCH): the web's 1 s rematch guard (tuning.gd REMATCH_DELAY, the web's SLAB.rematchDelay). Every press
## on a winner screen above now waits the guard out on the match's own clock (wait_guard: game.since_end, process
## delta). The mid-cue and mid-death cases freeze the HUD while they wait, because its cues fade in 0.35-0.6 s and the
## guard is 1 s. So the cues staged at the end are still up when the press lands, and they are checked again just
## before it. _guard then proves the rule, each time on a match ended by the real path (_check_end in a physics tick):
## (a) a press inside the guard (R two frames after the end, Enter at half of it) is ignored: the match stays over,
##     with the winner screen up and the score and winner unchanged;
## (c) the result holds by itself past the guard, and a fresh R press at or after 1 s rematches;
## (b) R held down from before the end until 1.5 s after it does not rematch, and its release does not either. A new
##     press then rematches.
## _end_frame (X3 patch) pins the clock itself: the frame the match ends in is not counted, and after it since_end is
## the process delta summed (without the skip the guard would open a frame before the web's 60 ticks).
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
	errs.append_array(await wait_guard(tree, game, "first to %d" % T.WIN_SCORE))
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
	errs.append_array(await _end_frame(tree, game))
	errs.append_array(await _guard(tree, game))
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
	# W17 X3: the press waits out the guard, with the HUD frozen so the cues staged at the end are still up for it
	hud.process_mode = Node.PROCESS_MODE_DISABLED
	e.append_array(await wait_guard(tree, game, tag))
	hud.process_mode = Node.PROCESS_MODE_INHERIT
	var still := {"confirm": hud.hit_t > 0.0, "wedge": hud.wedges.size() == 1, "flash": hud._flash.color.a > 0.0,
		"chip": hud._chip.visible, "feed": not game.feed.is_empty(), "winner screen": hud._winner.visible}
	if dead:
		still["remembered killer"] = not hud.down_by.is_empty()
		still["respawn countdown"] = game.respawn_left(me) > 0.0
	for cue in still:
		if not still[cue]:
			e.append("%s: setup, the %s is not up when the press lands (%.2f s after the end)" % [tag, cue, game.since_end])
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

## W17 X3: waits on the winner screen until the rematch guard has run out on the match's own clock (game.since_end,
## summed from process delta): a timer for what is left of it, then frames. It returns on a process_frame, before the
## nodes' _process, so an Input.action_press made next lands in that frame. A failure if the match left the winner
## screen by itself meanwhile (with a human present the result holds until a press).
static func wait_guard(tree: SceneTree, game: Node, tag: String) -> Array:
	if not game.over():
		return ["%s: setup, the match is not over before the guard wait" % tag]
	var left: float = T.REMATCH_DELAY - float(game.since_end)
	if left > 0.0:
		await tree.create_timer(left).timeout
	var n := 0
	while game.over() and game.since_end < T.REMATCH_DELAY and n < 600:
		await tree.process_frame
		n += 1
	await tree.process_frame
	if not game.over():
		return ["%s: the match left the winner screen by itself while the rematch guard ran out" % tag]
	if game.since_end < T.REMATCH_DELAY:
		return ["%s: setup, the guard had not run out after the wait (%.2f s since the end)" % [tag, game.since_end]]
	return []

## Ends the running match through the real path: `s` as the score, then one match tick (_check_end in the physics tick).
static func _end_by_score(tree: SceneTree, game: Node, s: Array) -> void:
	game.score = s.duplicate()
	await Kit.physics(tree, 2)

## The result still up: the match over, the winner screen shown, the score and the winner as at the end.
static func _holds(game: Node, tag: String, want: Dictionary) -> Array:
	if not game.over():
		return ["%s: the match restarted (score %s, state %d); the result must hold" % [tag, str(game.score), game.state]]
	var e: Array = []
	if not game.hud._winner.visible:
		e.append("%s: the winner screen is gone" % tag)
	if game.score != want.score or game.winner != want.winner:
		e.append("%s: score %s, winner %d; want %s, winner %d" % [tag, str(game.score), game.winner, str(want.score), want.winner])
	return e

## Presses `k` (down for two frames, then up) and lets one more frame run.
static func _tap(tree: SceneTree, k: Key) -> void:
	key(k, true)
	await tree.process_frame
	await tree.process_frame
	key(k, false)
	await tree.process_frame

## W17 X3 patch: the guard's clock. end_match runs before the _process of frame N (a process_frame callback runs
## before the nodes' _process), so N's delta is time from before the end. After Game._process(N), since_end must be
## exactly 0. After Game._process(N + 1) it must be exactly N + 1's process delta, which is what _process gets as
## `delta`. If the skip is removed, the first value is N's delta, and the guard opens one frame early.
func _end_frame(tree: SceneTree, game: Node) -> Array:
	if not game.playing():
		return ["end frame: setup, the match is not running"]
	var e: Array = []
	await tree.process_frame  # frame N, before its _process
	var d0 := tree.root.get_process_delta_time()
	game.end_match(0)
	await tree.process_frame  # frame N + 1, before its _process: Game._process(N) has run once since the end
	var s0: float = game.since_end
	var d1 := tree.root.get_process_delta_time()
	await tree.process_frame  # frame N + 2: Game._process(N + 1) has run
	var s1: float = game.since_end
	if d0 <= 0.0 or d1 <= 0.0:
		e.append("end frame: setup, a frame without process delta (%.6f s, %.6f s)" % [d0, d1])
	if not game.over():
		e.append("end frame: setup, the match did not stay over (state %d)" % game.state)
	if s0 != 0.0:
		e.append("end frame: since_end is %.6f s after the _process of the frame the match ended in, want exactly 0 (that frame's %.6f s delta is from before the end)" % [s0, d0])
	if s1 != d1:
		e.append("end frame: since_end is %.6f s one frame later, want exactly that frame's process delta, %.6f s" % [s1, d1])
	if e.is_empty():
		print("  end frame: since_end 0 after the end frame (its %.4f s delta skipped), then %.4f s = the next frame's delta" % [d0, s1])
	game.rematch()
	return e

## W17 X3: the guard itself. (a) a press inside it is ignored; (c) one at or after it rematches; (b) a key held down
## over the end and past the guard does not, until it is released and pressed again.
func _guard(tree: SceneTree, game: Node) -> Array:
	if not game.playing():
		return ["guard: setup, the match is not running"]
	var e: Array = []
	# (a) a press inside the guard is ignored, whether two frames or half the guard after the end
	await _end_by_score(tree, game, [T.WIN_SCORE, 17])
	if not game.over():
		return ["guard: setup, reaching %d did not end the match (score %s)" % [T.WIN_SCORE, str(game.score)]]
	var want := {"score": game.score.duplicate(), "winner": game.winner}
	var t0: float = game.since_end  # the press lands no sooner than this, and no later than `at` (after the tap)
	await _tap(tree, KEY_R)
	var at: float = game.since_end
	var t_a := [at]
	e.append_array(_holds(game, "(a) R pressed %.2f s after the end" % t0, want))
	if not e.is_empty():
		return e
	if at >= T.REMATCH_DELAY:
		return ["(a) setup: the early R landed %.2f s after the end, not inside the guard (a slow frame?)" % at]
	await tree.create_timer(maxf(0.0, 0.5 * T.REMATCH_DELAY - at)).timeout
	await tree.process_frame
	t0 = game.since_end
	await _tap(tree, KEY_ENTER)
	at = game.since_end
	t_a.append(at)
	e.append_array(_holds(game, "(a) Enter pressed %.2f s after the end" % t0, want))
	if not e.is_empty():
		return e
	if at >= T.REMATCH_DELAY:
		return ["(a) setup: the second early press landed %.2f s after the end, not inside the guard" % at]
	# (c) past the guard the result still holds by itself; a fresh press at or after 1 s rematches
	e.append_array(await wait_guard(tree, game, "(c)"))
	e.append_array(_holds(game, "(c) %.2f s after the end, before any press" % game.since_end, want))
	if not e.is_empty():
		return e
	at = game.since_end  # read before the tap: the press landed no sooner than this
	var t_c := at
	await _tap(tree, KEY_R)
	if not game.playing() or game.score != [0, 0] or game.winner != -1 or game.hud._winner.visible:
		return ["(c) a fresh R %.2f s after the end did not rematch (state %d, score %s, winner %d, winner screen %s)" % [
			at, game.state, str(game.score), game.winner, game.hud._winner.visible]]
	# (b) R held down from before the end and past the guard: no rematch; its release is no press either; a new one is
	key(KEY_R, true)
	await tree.process_frame
	await tree.process_frame
	if not game.playing():
		key(KEY_R, false)
		return ["(b) setup: R mid-match stopped the match (state %d)" % game.state]
	await _end_by_score(tree, game, [12, T.WIN_SCORE])
	if not game.over():
		key(KEY_R, false)
		return ["(b) setup: reaching %d did not end the match (score %s)" % [T.WIN_SCORE, str(game.score)]]
	want = {"score": game.score.duplicate(), "winner": game.winner}
	var hold := T.REMATCH_DELAY + 0.5
	await tree.create_timer(maxf(0.0, hold - game.since_end)).timeout
	var n := 0
	while game.over() and game.since_end < hold and n < 600:
		await tree.process_frame
		n += 1
	if not Input.is_action_pressed("rematch"):
		e.append("(b) setup: R is not held any more %.2f s after the end" % game.since_end)
	var t_b: float = game.since_end
	e.append_array(_holds(game, "(b) R held from before the end, %.2f s after it" % t_b, want))
	key(KEY_R, false)
	await tree.process_frame
	await tree.process_frame
	e.append_array(_holds(game, "(b) R released %.2f s after the end" % game.since_end, want))
	if not e.is_empty():
		return e
	at = game.since_end
	await _tap(tree, KEY_R)
	if not game.playing() or game.score != [0, 0]:
		e.append("(b) R pressed again %.2f s after the end did not rematch (state %d, score %s)" % [at, game.state, str(game.score)])
	if e.is_empty():
		print("  guard %.1f s: (a) R within %.2f s and Enter within %.2f s of the end ignored; (c) R at %.2f s rematched; (b) R held %.2f s past the end ignored, pressed again at %.2f s rematched" % [
			T.REMATCH_DELAY, t_a[0], t_a[1], t_c, t_b, at])
	return e

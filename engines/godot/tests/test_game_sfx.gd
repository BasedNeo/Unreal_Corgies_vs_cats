extends RefCounted
## A-HOOK (W13, W15): every cue plays when its event happens (game/sfx.gd), one play per event, from the six shared
## WAVs in public/assets/audio (16-bit mono 44.1 kHz). A recorder counts the game's own events (every rifle's `fired`,
## the human's `hit_confirmed`, `slab_point`, `match_over`) and each cue's plays must equal them exactly.
## - With the human (1 v 1): the human's shots through the fire input until the Cat bot goes down (each landed shot,
##   the kill too, is one hit_confirm), the Cat's shot, a slab point for each side, a win held on the slab from 59-0
##   and a loss with the Cat holding from 0-59.
## - Bots only (no human; "your side" is Corgi Company): bot play beside the slab at 4x speed (both bots' shots), a
##   point for each side, then the clock ends a win, a loss and a draw (the draw plays the lose sting).
## - A missing folder: one warning, every cue silent, no error, no crash.
## Run with `-- --sfx-log` to print `SFX <cue> <seconds>` for every play.
const Kit := preload("res://game/testkit.gd")
const Sfx := preload("res://game/sfx.gd")
const T := preload("res://game/tuning.gd")
## Bots-only play runs at SPEED x for PLAY s of game time.
const SPEED := 4.0
const PLAY := 16.0

## Counts the warnings Sfx pushes (Kit's logger drops warnings).
class WarnLog extends Logger:
	var sfx_warnings := 0
	var _mx := Mutex.new()
	func _log_error(_function: String, _file: String, _line: int, code: String, rationale: String, _notify: bool,
			error_type: int, _bt: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_WARNING and ("Sfx:" in code or "Sfx:" in rationale):
			_mx.lock()
			sfx_warnings += 1
			_mx.unlock()
	func _log_message(_message: String, _error: bool) -> void:
		pass

## The game's events, counted by the cue each one should play. "Your side" is worked out here, not read from sfx.gd.
class Rec extends RefCounted:
	var n := {"rifle_shot": 0, "hit_confirm": 0, "slab_tick": 0, "slab_tick_enemy": 0, "match_end_win": 0,
		"match_end_lose": 0}
	var shots := [0, 0]
	var kills := 0
	var base := {}
	var mine := 0
	func hook(game: Node, sfx: Node) -> void:
		base = sfx.counts.duplicate()
		mine = int(game.player.team) if game.player != null else 0
		for p in game.pets:
			p.rifle.fired.connect(_fired.bind(p))
		if game.player != null:
			game.player.hit_confirmed.connect(_confirmed)
		game.slab_point.connect(_point)
		game.match_over.connect(_over)
	func _fired(_res: Dictionary, p: Node) -> void:
		n.rifle_shot += 1
		shots[int(p.team)] += 1
	func _confirmed(res: Dictionary) -> void:
		n.hit_confirm += 1
		kills += 1 if bool(res.get("kill", false)) else 0
	func _point(team: int) -> void:
		n["slab_tick" if team == mine else "slab_tick_enemy"] += 1
	func _over(w: int) -> void:
		n["match_end_win" if w >= 0 and w == mine else "match_end_lose"] += 1
	## Every cue's plays since hook() against its events; and each cue in `want` played at least once.
	func check(sfx: Node, label: String, want: Array) -> Array:
		var errs: Array = []
		for cue in n:
			var played := int(sfx.counts[cue]) - int(base.get(cue, 0))
			if played != int(n[cue]):
				errs.append("%s: %s played %d times for %d events" % [label, cue, played, n[cue]])
		for cue in want:
			if int(n[cue]) < 1:
				errs.append("%s: no %s event happened" % [label, cue])
		print("  %s: events %s" % [label, str(n)])
		return errs

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	errs.append_array(await _human(tree))
	errs.append_array(await _bots_only(tree))
	errs.append_array(await _missing(tree))
	errs.append_array(Kit.unwatch(log))
	return errs

static func _files(sfx: Node) -> Array:
	var errs: Array = []
	for cue in Sfx.CUES:
		var s: AudioStreamWAV = sfx.streams.get(cue)
		if s == null:
			errs.append("cue %s: %s did not load" % [cue, sfx.audio_dir.path_join(Sfx.CUES[cue])])
		elif s.format != AudioStreamWAV.FORMAT_16_BITS or s.stereo or s.mix_rate != 44100:
			errs.append("cue %s: not 16-bit mono 44.1 kHz (format %d, stereo %s, %d Hz)" % [cue, s.format, s.stereo, s.mix_rate])
	return errs

## Holds the match until it is over (the game's own tick: slab points, the clock), at most `frames` physics frames.
static func _until_over(tree: SceneTree, game: Node, frames: int) -> void:
	for i in frames:
		if game.over():
			return
		await tree.physics_frame

func _human(tree: SceneTree) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	var sfx: Node = main.get_node_or_null("Sfx")
	if sfx == null or not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("no Sfx node in main.tscn, or the 1 v 1 did not start")
		await Kit.dispose(tree, main)
		return errs
	errs.append_array(_files(sfx))
	if not errs.is_empty():
		await Kit.dispose(tree, main)
		return errs
	var rec := Rec.new()
	rec.hook(game, sfx)
	var player: Node = game.player
	var bot: Node = game.pets[1]
	bot.set_physics_process(false)  # the Cat bot stands where the test puts it
	bot.shield = 0.0
	await Kit.physics(tree, 5)
	# 1. the human fires through the input, one shot at a time, with the Cat bot put on the camera's line 7 m out
	#    before each shot (the recoil moves the camera), until the Cat is down
	var cam: Camera3D = player.camera
	for i in 40:
		if not bot.alive:
			break
		var chest := cam.global_position - cam.global_basis.z * 7.0
		bot.global_position = chest - Vector3(0, T.height(bot.species) * 0.55, 0)
		await tree.physics_frame
		Input.action_press("fire")
		await tree.physics_frame
		Input.action_release("fire")
		await Kit.physics(tree, 6)  # the 10 shots/s cooldown
	print("  human: %d shots, %d landed, Cat down: %s" % [rec.shots[0], rec.n.hit_confirm, not bot.alive])
	if rec.shots[0] < 1:
		errs.append("the human fired no shot through the fire input")
	if bot.alive or rec.kills != 1:
		errs.append("the human's shots did not take the Cat down (alive %s, kill confirms %d)" % [bot.alive, rec.kills])
	var shot: AudioStreamPlayer3D = sfx._shots[(sfx._shot_i + sfx._shots.size() - 1) % sfx._shots.size()]
	if shot.global_position.distance_to(player.rifle.muzzle.global_position) > 1.0:
		errs.append("the shot played %.2f m from the muzzle" % shot.global_position.distance_to(player.rifle.muzzle.global_position))
	if shot.attenuation_model != AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE or shot.max_distance <= 0.0:
		errs.append("the shot does not fade with distance (model %d, max %.0f m)" % [shot.attenuation_model, shot.max_distance])
	# 2. the Cat's shot, at its own muzzle
	bot.respawn(bot.global_position, 0.0)
	bot.rifle.refill()
	bot.rifle.shoot(bot.eye(), Vector3.FORWARD, 0.0)
	if rec.shots[1] != 1:
		errs.append("the Cat bot's shot was not counted (%d)" % rec.shots[1])
	# 3. the slab: a point for each side (no awaits: the match's own tick does not run between these steps)
	player.set_physics_process(false)
	var c: Vector3 = game.slab.center
	var far := c + Vector3(0, 0, 60)
	player.global_position = c
	bot.global_position = far
	game.step_score(1.0)
	player.global_position = far
	bot.global_position = c
	game.step_score(1.0)
	# 4. the win: one point short, the human holds the slab until the match is over
	player.global_position = c
	bot.global_position = far
	game.score = [T.WIN_SCORE - 1, 0]
	await _until_over(tree, game, 150)
	if not game.over() or game.winner != 0:
		errs.append("holding the slab at %d-0 did not win (score %s)" % [T.WIN_SCORE - 1, str(game.score)])
	# 5. the loss: a rematch, the Cat holds the slab from 0-59
	game.rematch()
	player.global_position = far
	bot.global_position = c
	game.score = [0, T.WIN_SCORE - 1]
	await _until_over(tree, game, 150)
	if not game.over() or game.winner != 1:
		errs.append("the Cat holding the slab at 0-%d did not win (score %s)" % [T.WIN_SCORE - 1, str(game.score)])
	errs.append_array(rec.check(sfx, "human", Sfx.CUES.keys()))
	print("  sfx counts: %s" % str(sfx.counts))
	await Kit.dispose(tree, main)
	return errs

func _bots_only(tree: SceneTree) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"human": false, "allies": 0, "enemies": 1, "think": true, "demo": true})
	var game: Node = main.get_node("Game")
	var sfx: Node = main.get_node_or_null("Sfx")
	if sfx == null or not game.playing() or game.player != null or game.pets.size() != 2:
		errs.append("bots only: the 1 v 1 of bots did not start")
		await Kit.dispose(tree, main)
		return errs
	if sfx.my_team() != 0:
		errs.append("bots only: sfx.gd takes team %d as your side (want Corgi Company, 0)" % sfx.my_team())
	var rec := Rec.new()
	rec.hook(game, sfx)
	# 1. bot play beside the slab (--demo) at 4x speed, each tick still 1/60 s: PLAY s of game time, or longer (at
	#    most 40 s) until both bots have fired; whatever points the bots score meanwhile tick as well
	var ticks0 := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = int(ticks0 * SPEED)
	Engine.time_scale = SPEED
	var t0 := Time.get_ticks_msec()
	while game.playing() and game.elapsed < 40.0 and (game.elapsed < PLAY or rec.shots[0] < 1 or rec.shots[1] < 1) \
			and Time.get_ticks_msec() - t0 < 40000:
		await tree.physics_frame
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = ticks0
	print("  bots only: %.1f s of play in %.1f s, shots %s, score %s" % [game.elapsed, (Time.get_ticks_msec() - t0) / 1000.0,
		str(rec.shots), str(game.score)])
	if rec.shots[0] < 1 or rec.shots[1] < 1:
		errs.append("bots only: not both bots fired in %.0f s of play (shots %s)" % [game.elapsed, str(rec.shots)])
	# 2. a point for each side (the bots held where the test puts them)
	for p in game.pets:
		p.set_physics_process(false)
	var corgi: Node = game.pets[0]
	var cat: Node = game.pets[1]
	var c: Vector3 = game.slab.center
	var far := c + Vector3(0, 0, 60)
	if game.playing():
		for p in game.pets:
			if not p.alive:
				p.respawn(far, 0.0)
		corgi.global_position = c
		cat.global_position = far
		game.step_score(1.0)
		corgi.global_position = far
		cat.global_position = c
		game.step_score(1.0)
	# 3. the clock ends a win, a loss and a draw (nobody on the slab, so the score stays put)
	for e in [[[10, 5], 0], [[5, 10], 1], [[7, 7], -1]]:
		if not game.playing():
			game.rematch()
		for p in game.pets:
			p.global_position = far + Vector3(3.0 * p.team, 0, 0)
		game.score = e[0].duplicate()
		game.time_left = 0.05
		await _until_over(tree, game, 10)
		if not game.over() and game.overtime:
			game.overtime_t = T.OVERTIME_MAX
			await _until_over(tree, game, 10)
		if not game.over() or game.winner != e[1]:
			errs.append("bots only: the clock at %s did not end the match for %d (winner %d)" % [str(e[0]), e[1], game.winner])
		game.rematch()
	errs.append_array(rec.check(sfx, "bots only", ["rifle_shot", "slab_tick", "slab_tick_enemy", "match_end_win", "match_end_lose"]))
	if int(rec.n.match_end_lose) != 2:
		errs.append("bots only: %d lose stings for a loss and a draw (want 2)" % rec.n.match_end_lose)
	await Kit.dispose(tree, main)
	return errs

## No cue files: a full match runs with every cue silent, one warning, no engine error.
func _missing(tree: SceneTree) -> Array:
	var errs: Array = []
	var warn := WarnLog.new()
	OS.add_logger(warn)
	var main: Node = load("res://main.tscn").instantiate()
	var game: Node = main.get_node("Game")
	game.opts.think = true
	var sfx: Node = main.get_node("Sfx")
	sfx.audio_dir = "/nonexistent/cvc-sfx-test"
	tree.root.add_child(main)
	for i in 600:
		if game.playing():
			break
		await tree.process_frame
	Input.action_press("fire")
	await Kit.physics(tree, 20)
	Input.action_release("fire")
	game.score = [0, T.WIN_SCORE - 1]
	game.slab_point.emit(1)
	game.end_match(1)
	game.rematch()
	sfx.play("hit_confirm")
	sfx.play_at("rifle_shot", Vector3.ZERO)
	OS.remove_logger(warn)
	if sfx.missing.size() != Sfx.CUES.size():
		errs.append("missing folder: %d cues reported missing (want %d)" % [sfx.missing.size(), Sfx.CUES.size()])
	for cue in sfx.counts:
		if int(sfx.counts[cue]) != 0:
			errs.append("missing folder: %s counted %d plays" % [cue, sfx.counts[cue]])
	if warn.sfx_warnings != 1:
		errs.append("missing folder: %d Sfx warnings (want exactly 1)" % warn.sfx_warnings)
	if not game.playing():
		errs.append("missing folder: the match did not run")
	await Kit.dispose(tree, main)
	return errs

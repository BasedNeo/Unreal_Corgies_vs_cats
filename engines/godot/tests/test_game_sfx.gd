extends RefCounted
## A-HOOK (W13): the match's four cues (game/sfx.gd). In a 1 v 1, every cue plays from the shared WAVs: the rifle shot
## (3D, at the muzzle, fading with distance), the hit confirm when the human's shot lands on the Cat bot, a slab tick
## for each side's point (yours / the enemy's), and the match end (win / lose). The six files load from
## public/assets/audio as 16-bit mono 44.1 kHz. A missing folder: one warning, every cue silent, no error, no crash.
const Kit := preload("res://game/testkit.gd")
const Sfx := preload("res://game/sfx.gd")
const T := preload("res://game/tuning.gd")

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

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	errs.append_array(await _match(tree))
	errs.append_array(await _missing(tree))
	errs.append_array(Kit.unwatch(log))
	return errs

func _match(tree: SceneTree) -> Array:
	var errs: Array = []
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 0, "enemies": 1, "think": false})
	var game: Node = main.get_node("Game")
	var sfx: Node = main.get_node_or_null("Sfx")
	if sfx == null or not game.playing() or game.player == null or game.pets.size() != 2:
		errs.append("no Sfx node in main.tscn, or the 1 v 1 did not start")
		await Kit.dispose(tree, main)
		return errs
	for cue in Sfx.CUES:
		var s: AudioStreamWAV = sfx.streams.get(cue)
		if s == null:
			errs.append("cue %s: %s did not load" % [cue, sfx.audio_dir.path_join(Sfx.CUES[cue])])
		elif s.format != AudioStreamWAV.FORMAT_16_BITS or s.stereo or s.mix_rate != 44100:
			errs.append("cue %s: not 16-bit mono 44.1 kHz (format %d, stereo %s, %d Hz)" % [cue, s.format, s.stereo, s.mix_rate])
	if not errs.is_empty():
		await Kit.dispose(tree, main)
		return errs
	var player: Node = game.player
	var bot: Node = game.pets[1]
	bot.set_physics_process(false)  # the Cat bot stands where the test puts it
	await Kit.physics(tree, 5)
	# 1. the rifle: the Cat bot on the camera's line 7 m out, fire until a shot lands
	var cam: Camera3D = player.camera
	var chest := cam.global_position - cam.global_basis.z * 7.0
	bot.global_position = chest - Vector3(0, T.height(bot.species) * 0.55, 0)
	bot.shield = 0.0
	Input.action_press("fire")
	for i in 90:
		await tree.physics_frame
		if int(sfx.counts.hit_confirm) > 0:
			break
	Input.action_release("fire")
	print("  sfx: %d shots, %d hit confirms" % [sfx.counts.rifle_shot, sfx.counts.hit_confirm])
	if int(sfx.counts.rifle_shot) < 1:
		errs.append("no rifle_shot played while the human fired")
	if int(sfx.counts.hit_confirm) < 1:
		errs.append("no hit_confirm played: no shot landed on the Cat bot in 1.5 s of fire")
	var shot: AudioStreamPlayer3D = sfx._shots[(sfx._shot_i + sfx._shots.size() - 1) % sfx._shots.size()]
	if shot.global_position.distance_to(player.rifle.muzzle.global_position) > 1.0:
		errs.append("the shot played %.2f m from the muzzle" % shot.global_position.distance_to(player.rifle.muzzle.global_position))
	if shot.attenuation_model != AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE or shot.max_distance <= 0.0:
		errs.append("the shot does not fade with distance (model %d, max %.0f m)" % [shot.attenuation_model, shot.max_distance])
	# a Cat bot's shot plays as well, at its own muzzle
	if not bot.alive:
		bot.respawn(bot.global_position, 0.0)
	bot.rifle.refill()
	var n0 := int(sfx.counts.rifle_shot)
	bot.rifle.shoot(bot.eye(), Vector3.FORWARD, 0.0)
	if int(sfx.counts.rifle_shot) != n0 + 1:
		errs.append("the Cat bot's shot played no rifle_shot")
	# 2. the slab: a point for each side (no awaits: the match's own tick does not run between these steps)
	player.set_physics_process(false)
	var c: Vector3 = game.slab.center
	var far := c + Vector3(0, 0, 60)
	player.global_position = c
	bot.global_position = far
	var own0 := int(sfx.counts.slab_tick)
	var foe0 := int(sfx.counts.slab_tick_enemy)
	game.step_score(1.0)
	if int(sfx.counts.slab_tick) != own0 + 1 or int(sfx.counts.slab_tick_enemy) != foe0:
		errs.append("the human's slab point: slab_tick %d -> %d, slab_tick_enemy %d -> %d (want +1, +0)" % [
			own0, sfx.counts.slab_tick, foe0, sfx.counts.slab_tick_enemy])
	player.global_position = far
	bot.global_position = c
	game.step_score(1.0)
	if int(sfx.counts.slab_tick_enemy) != foe0 + 1 or int(sfx.counts.slab_tick) != own0 + 1:
		errs.append("the Cat bot's slab point: slab_tick_enemy %d -> %d (want +1)" % [foe0, sfx.counts.slab_tick_enemy])
	# 3. the end: one point short of the win, hold the slab until the match is over
	player.global_position = c
	bot.global_position = far
	game.score = [T.WIN_SCORE - 1, 0]
	for i in 150:
		await tree.physics_frame
		if game.over():
			break
	if not game.over() or game.winner != 0:
		errs.append("holding the slab at %d did not win the match (score %s)" % [T.WIN_SCORE - 1, str(game.score)])
	if int(sfx.counts.match_end_win) != 1 or int(sfx.counts.match_end_lose) != 0:
		errs.append("the win: match_end_win %d, match_end_lose %d (want 1, 0)" % [sfx.counts.match_end_win, sfx.counts.match_end_lose])
	game.rematch()
	game.end_match(1)
	if int(sfx.counts.match_end_lose) != 1:
		errs.append("the loss: match_end_lose %d (want 1)" % sfx.counts.match_end_lose)
	print("  sfx counts: %s" % str(sfx.counts))
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

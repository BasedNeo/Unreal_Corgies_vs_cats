extends Node
## Sfx (W13 A-HOOK): the match's four cues, from the one set of WAVs this build shares with the web twin's slab mode
## (public/assets/audio/, read at runtime the way the world reads the kit GLBs: nothing is copied into this project).
## No music.
##   rifle_shot                       every pet's shot, 3D at its muzzle (AudioStreamPlayer3D, fades with distance)
##   hit_confirm                      your shot landed on a pet (player.gd hit_confirmed), 2D
##   slab_tick / slab_tick_enemy      a slab point for your side / the other side (match.gd slab_point), 2D
##   match_end_win / match_end_lose   the match ended: your side won / did not (a draw too) (match.gd match_over), 2D
## "Your side" is the human's team, or Corgi Company when the bots play alone (as the web: me ? me.team : 0).
## A missing or unreadable file: one warning for the lot, then those cues stay silent; nothing else changes.
## User arg --sfx-log prints `SFX <cue> <seconds since start>` on every play (it works headless: with the Dummy
## audio driver the players still play).

const CUES := {
	"rifle_shot": "synth_rifle_shot.wav",
	"hit_confirm": "synth_hit_confirm.wav",
	"slab_tick": "synth_slab_tick.wav",
	"slab_tick_enemy": "synth_slab_tick_enemy.wav",
	"match_end_win": "synth_match_end_win.wav",
	"match_end_lose": "synth_match_end_lose.wav",
}
## Play levels (dB) per cue: A-CUES's starting gains (every file peaks at -3 dBFS; the ticks repeat once a second), not
## yet tuned by ear. The web plays the same files at the same levels (src/client/audio/slab-cues.ts SLAB_CUE_DB).
const VOLUME_DB := {
	"rifle_shot": 0.0, "hit_confirm": -6.0, "slab_tick": -14.0, "slab_tick_enemy": -14.0, "match_end_win": -4.0,
	"match_end_lose": -4.0,
}
## Shots: full level within SHOT_UNIT m, inverse distance beyond, silent past SHOT_MAX_DIST m (the web's panner:
## refDistance 4, inverse, culled at 80 m). Up to SHOT_VOICES shots ring at once (four pets at 10 shots/s).
const SHOT_UNIT := 4.0
const SHOT_MAX_DIST := 80.0
const SHOT_VOICES := 12

## The folder of the cue files (absolute). Empty: res://../../public/assets/audio. Set before _ready (tests).
var audio_dir := ""
var log_plays := false
var game: Node = null
## cue -> AudioStreamWAV, or null when its file is missing or unreadable
var streams := {}
## cue -> times played
var counts := {}
## cues without a file
var missing: PackedStringArray = []
var _ui := {}
var _shots: Array[AudioStreamPlayer3D] = []
var _shot_i := 0
var _hooked := {}

func _ready() -> void:
	log_plays = log_plays or OS.get_cmdline_user_args().has("--sfx-log")
	if audio_dir == "":
		audio_dir = ProjectSettings.globalize_path("res://").path_join("../../public/assets/audio").simplify_path()
	for cue in CUES:
		counts[cue] = 0
		streams[cue] = _load(cue)
	if not missing.is_empty():
		push_warning("Sfx: no playable file for %s in %s; those cues stay silent" % [", ".join(missing), audio_dir])
	for cue in CUES:
		if cue == "rifle_shot":
			continue
		var p := AudioStreamPlayer.new()
		p.name = cue.to_pascal_case()
		p.stream = streams[cue]
		p.volume_db = VOLUME_DB[cue]
		p.max_polyphony = 3
		add_child(p)
		_ui[cue] = p
	for i in SHOT_VOICES:
		var s := AudioStreamPlayer3D.new()
		s.name = "Shot%d" % i
		s.stream = streams.rifle_shot
		s.volume_db = VOLUME_DB.rifle_shot
		s.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		s.unit_size = SHOT_UNIT
		s.max_distance = SHOT_MAX_DIST
		add_child(s)
		_shots.append(s)
	if game == null and get_parent() != null:
		game = get_parent().get_node_or_null("Game")
	if game != null:
		game.match_started.connect(_hook)
		game.match_over.connect(_on_match_over)
		if game.has_signal("slab_point"):
			game.slab_point.connect(_on_slab_point)
		_hook()

func _load(cue: String) -> AudioStream:
	var path := audio_dir.path_join(CUES[cue])
	var s: AudioStream = AudioStreamWAV.load_from_file(path) if FileAccess.file_exists(path) else null
	if s == null:
		missing.append(cue)
	return s

## Every pet's rifle and the human's hit confirm (match.gd spawns the pets right before match_started).
func _hook() -> void:
	if game == null:
		return
	for p in game.pets:
		var r: Node = p.get("rifle")
		if r != null and not _hooked.has(r.get_instance_id()):
			_hooked[r.get_instance_id()] = true
			r.fired.connect(_on_fired.bind(p))
	var pl: Node = game.player
	if pl != null and not _hooked.has(pl.get_instance_id()):
		_hooked[pl.get_instance_id()] = true
		pl.hit_confirmed.connect(_on_hit_confirmed)

## The human's team, or Corgi Company (0) when the bots play alone.
func my_team() -> int:
	return int(game.player.team) if game != null and game.player != null else 0

func _on_fired(_res: Dictionary, pet: Node) -> void:
	if not is_instance_valid(pet):
		return
	var r: Node = pet.rifle
	play_at("rifle_shot", r.muzzle.global_position if r.muzzle != null else pet.global_position + Vector3(0, 0.7, 0))

func _on_hit_confirmed(_res: Dictionary) -> void:
	play("hit_confirm")

func _on_slab_point(team: int) -> void:
	play("slab_tick" if team == my_team() else "slab_tick_enemy")

func _on_match_over(winner: int) -> void:
	play("match_end_win" if winner >= 0 and winner == my_team() else "match_end_lose")

## A 2D cue. Returns false (silently) when its file is missing.
func play(cue: String) -> bool:
	var p: AudioStreamPlayer = _ui.get(cue)
	if p == null or p.stream == null or not is_inside_tree():
		return false
	p.play()
	_played(cue)
	return true

## A 3D cue at `pos` (world), on the next shot voice.
func play_at(cue: String, pos: Vector3) -> bool:
	if streams.get(cue) == null or _shots.is_empty() or not is_inside_tree():
		return false
	var s := _shots[_shot_i]
	_shot_i = (_shot_i + 1) % _shots.size()
	s.stream = streams[cue]
	s.global_position = pos
	s.play()
	_played(cue)
	return true

func _played(cue: String) -> void:
	counts[cue] = int(counts.get(cue, 0)) + 1
	if log_plays:
		print("SFX %s %.3f" % [cue, Time.get_ticks_msec() / 1000.0])

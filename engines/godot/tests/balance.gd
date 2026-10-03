extends SceneTree
## Balance harness (lane G-BOT, W13): plays full bots-only matches with the real rules (match.gd: first to 60, else the
## lead at 3:00, overtime up to 60 s) on The Lot and prints one line per match, then a summary. Not part of
## tests/run.gd: a match is 60-240 s of game time. tests/test_game_balance.gd is the fast smoke check.
##
##   godot --headless --path engines/godot --script res://tests/balance.gd -- --format 2v2 --n 20 --seed 100
##
## --format 1v1|2v2   one Corgi bot vs one Cat bot, or two vs two (match.gd opts, as --bots-only / --bots-only --2v2)
## --n N              matches, one after the other on the same world (match.gd start_match, the R rematch path)
## --seed S           match i uses seed S + i for the global RNG (spawn jitter) and every bot's and rifle's RNG, and
##                    resets the bots' think state. A seed does NOT reliably replay a match in another process: a rerun
##                    of the shipped 2v2 on seeds 101-160 changed 15 of 60 winners, while seeds 1-60 changed none (a
##                    likely cause, not proven: the boot's pre-match physics ticks depend on wall time). Treat each seed
##                    block as an independent sample.
## --speed K          K x 60 physics ticks per real second with Engine.time_scale K: every tick still steps 1/60 s
##                    (test_game_soak's method). The run goes up to K x real time, slower if the CPU cannot keep up.
##                    --speed 1 is real time.
## --max-game T       end a match after T s of game time (no winner): for comparing speeds per event
## --events           print every takedown (game time, killer, victim, distance)
## --jump-up H        bot ledge-jump height override (bot.gd LEDGE_JUMP), for the A/B in docs/handoff/G-BOT.md
## --ttk M            lethality: the Cat bot on the slab against you (a Corgi, no input but A/D) standing M m away on
##                    open ground (match.gd --lineup M); n kills with you still, n with you strafing (A/D, switching
##                    every 0.5-1.0 s); prints the time to kill from exposure (includes the bot's reaction) and from its
##                    first shot
## --holder S         the verifier's case (W14): you (a Corgi, no input, kept unhurt) stand in the middle of the slab and
##                    the Cat bot comes from its start slot and fights you for S s per trial (n trials). Prints where the
##                    bot is from its first sight of you on (inside the margin, in the volume's edge band, on the lip,
##                    farther out), how often the slab flips to contested, and your points after it arrived
## --trace            per match, a TRACE line: bot jumps per side by distance from the slab (and how many in a fight),
##                    seconds airborne (all, and within 30 m of the slab), shots at airborne and grounded targets with
##                    their hit rates, and deaths by distance from the slab (and how many airborne); per Corgi life,
##                    the time to cross the slab path's band (PATH_S along its line: the pit ramp, trench notches),
##                    seconds there with a teammate within 1.5 m; stalls (0.6 s under 0.6 m/s off the slab, as bot.gd
##                    counts stuck) by distance from the slab
## --duel M           species check: a thinking bot on the slab shoots a still bot of the other species standing on
##                    open ground M m away (the --lineup spot), n times each way round (Corgi shooting a Cat, Cat
##                    shooting a Corgi); prints the hit rate and the time to kill per shooter species
## --routes           pathing only, no fight: one bot of each side in turn walks from each of its team's 16 spawns (and
##                    each respawn point that is not a spawn) to the slab alone; prints time to the slab's edge, jumps,
##                    step-ups and the longest stall per point, and which start slot / respawn point it is. With
##                    --reps R every point runs R times (seeds S + i + 1000 r: a different goal on the slab each time)
##                    and the line gives the mean and the range
## Per match: format, seed, winner, score, takedowns per side, seconds with a pet of each side on the slab, seconds
## each side held it alone (scored), shots / hits / hit rate per side, first arrival on the slab per side, and the
## mean spawn-to-slab time per life.
const T := preload("res://game/tuning.gd")
const SIDE := ["Corgi", "Cat"]
## Slab position metrics (W14 CONTEST): "inside" = in slab.gd contains() at least MARGIN m from every edge (bot.gd
## SLAB_MARGIN); "the lip" = outside the volume but within LIP m of its square.
const MARGIN := 1.0
const LIP := 3.0

var fmt := "1v1"
var n := 10
var seed0 := 1
var speed := 8.0
var max_game := 0.0
var events := false
var trace := false
## Distance bins from the slab's centre for --trace: under 20 m, 20-60, 60-100, 100 m and over.
const BINS := [20.0, 60.0, 100.0]
var jump_up := -1.0
var routes := false
var reps := 1
var ttk := 0.0
var holder := 0.0
var duel := 0.0

func _init() -> void:
	_run.call_deferred()

func _args() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		var v: String = a[i + 1] if i + 1 < a.size() else ""
		match a[i]:
			"--format": fmt = v
			"--n": n = int(v)
			"--seed": seed0 = int(v)
			"--speed": speed = maxf(1.0, float(v))
			"--max-game": max_game = float(v)
			"--events": events = true
			"--trace": trace = true
			"--jump-up": jump_up = float(v)
			"--routes": routes = true
			"--reps": reps = maxi(1, int(v))
			"--ttk": ttk = float(v)
			"--holder": holder = float(v)
			"--duel": duel = float(v)

func _run() -> void:
	_args()
	var duo := fmt == "2v2"
	var main: Node = load("res://main.tscn").instantiate()
	var game: Node = main.get_node("Game")
	var o := {"human": false, "allies": 1 if duo else 0, "enemies": 2 if duo else 1, "think": true}
	if routes:
		o.enemies = 1
	if ttk > 0.0:
		o = {"lineup": ttk}
	if holder > 0.0:
		o = {"human": true, "allies": 0, "enemies": 1, "think": true}
	if duel > 0.0:
		o = {"human": false, "allies": 0, "enemies": 1, "think": true}
	for k in o:
		game.opts[k] = o[k]
	root.add_child(main)
	for i in 1200:
		if game.playing() and game.nav_ready():
			break
		await process_frame
	if not game.playing() or not game.nav_ready():
		print("BALANCE FAIL: the match did not start with a ready nav map")
		quit(1)
		return
	if jump_up >= 0.0:
		for p in game.pets:
			p.set("ledge_jump", jump_up)
	Engine.physics_ticks_per_second = int(60.0 * speed)
	Engine.time_scale = speed
	Engine.max_physics_steps_per_frame = maxi(8, int(speed * 2.0))
	print("BALANCE %s · n %d · seeds %d..%d · speed x%.0f (tick %.4f s) · ledge jump %s" % [fmt, n, seed0, seed0 + n - 1,
		speed, speed / Engine.physics_ticks_per_second, str(game.pets[0].get("ledge_jump"))])
	if routes:
		await _routes(game)
		quit(0)
		return
	if ttk > 0.0:
		await _ttk(game)
		quit(0)
		return
	if holder > 0.0:
		await _holder(game)
		quit(0)
		return
	if duel > 0.0:
		await _duel(game)
		quit(0)
		return
	for i in 2:  # match.gd picks its slots by nav path on the first tick the map serves paths
		await physics_frame
	_print_slots(game)
	var rows: Array = []
	var t_real := Time.get_ticks_msec()
	for i in n:
		rows.append(await _match(game, seed0 + i))
	_summary(rows, (Time.get_ticks_msec() - t_real) / 1000.0)
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = 60
	quit(0)

## Each side's bot walks alone (the other is taken out of game.pets, parked and frozen) from every spawn of its team.
func _routes(game: Node) -> void:
	var bots: Array = game.pets.duplicate()
	var all := [[], []]
	var t_real := Time.get_ticks_msec()
	for b in bots:
		game.pets = [b]
		for o in bots:
			o.think = o == b
			if o != b:  # parked at its own base, out of the way and out of game.pets (so nobody sees it)
				var home: Vector3 = game.spawns[o.team][15]
				o.respawn(home, 0.0)
		var team: int = b.team
		var pts: Array = []  # [point, label]
		for i in game.spawns[team].size():
			pts.append([game.spawns[team][i], "spawn %2d" % i])
		var rs = game.get("respawn_slots")
		if rs is Array:
			for q in rs[team]:
				if not game.spawns[team].any(func(x): return (x as Vector3).distance_to(q) < 0.3):
					pts.append([q, "respawn pt"])
		var starts: Array = game.start_slots(team) if game.has_method("start_slots") else []
		for k in pts.size():
			var sp: Vector3 = pts[k][0]
			var tags: Array = []
			for j in mini(2, starts.size()):
				if (starts[j] as Vector3).distance_to(sp) < 0.3:
					tags.append("start slot %d" % j)
			if rs is Array and rs[team].any(func(x): return (x as Vector3).distance_to(sp) < 0.3):
				tags.append("respawn")
			var times: Array = []
			var band_t := 0.0
			var band_n := 0
			var air_t := 0.0
			var j0: int = b.jumps
			var s0: int = b.steps
			var worst := 0.0
			for r in reps:
				_reseed(game, seed0 + k + 1000 * r)
				game.start_match()
				b.respawn(sp, game._yaw_to(sp, game.slab.center))
				var t0: float = game.elapsed
				var stall := 0.0
				var reached := -1.0
				var b_in := -1.0
				var b_out := -1.0
				while game.playing() and game.elapsed - t0 < 60.0:
					await physics_frame
					if game.slab.contains(b.global_position):
						reached = game.elapsed - t0
						break
					stall = stall + 1.0 / 60.0 if Vector2(b.velocity.x, b.velocity.z).length() < 1.0 else 0.0
					worst = maxf(worst, stall)
					if not b.is_on_floor():
						air_t += 1.0 / 60.0
					var sl := _path_s(b.global_position)
					if b_in < 0.0 and sl >= PATH_S.x:
						b_in = game.elapsed - t0
					if b_out < 0.0 and sl >= PATH_S.y:
						b_out = game.elapsed - t0
				times.append(reached)
				if team == 0 and b_in >= 0.0 and b_out >= 0.0:
					band_t += b_out - b_in
					band_n += 1
			var ok: Array = times.filter(func(x): return x >= 0.0)
			var d := Vector2(sp.x - game.slab.center.x, sp.z - game.slab.center.z).length()
			var mean := -1.0
			if ok.size() == times.size():
				mean = 0.0
				for x in ok:
					mean += x
				mean /= ok.size()
			all[team].append({"t": mean, "j": b.jumps - j0, "s": b.steps - s0, "stall": worst, "d": d})
			var st := ""
			if game.has_method("_sprint_time"):
				st = " · straight-line sprint %.2f s" % (d / float(T.MOVE[team].sprint))
			var span := ""
			if reps > 1 and not ok.is_empty():
				span = " (%.2f-%.2f, %d runs)" % [ok.min(), ok.max(), times.size()]
			var extra := " · airborne %.2f s per run" % (air_t / reps)
			if band_n > 0:
				extra += " · slab-path band (%.0f-%.0f m along its line) crossed in %.2f s" % [PATH_S.x, PATH_S.y, band_t / band_n]
			print("ROUTE %s %s (%.1f, %.1f) %.1f m%s: %s%s · jumps %.1f · step-ups %.1f per run · longest stall %.2f s%s%s" % [
				SIDE[team], pts[k][1], sp.x, sp.z, d, " [" + ", ".join(tags) + "]" if not tags.is_empty() else "",
				"slab in %.2f s" % mean if mean >= 0.0 else "NOT REACHED in 60 s (%d of %d)" % [times.size() - ok.size(), times.size()],
				span, float(b.jumps - j0) / reps, float(b.steps - s0) / reps, worst, st, extra])
	for team in 2:
		var ok: Array = all[team].filter(func(r): return r.t >= 0.0)
		var ts: Array = ok.map(func(r): return r.t)
		var js := 0
		var ss := 0
		var worst := 0.0
		var slow := 0.0
		for r in all[team]:
			js += r.j
			ss += r.s
			worst = maxf(worst, r.stall)
		for r in ok:
			slow = maxf(slow, r.t)
		print("ROUTES %s · reached %d/%d · mean %s s · slowest %.2f s · jumps %.1f · step-ups %.1f per point · longest stall %.2f s · ledge jump %.2f m" % [
			SIDE[team], ok.size(), all[team].size(), _mean_s(ts), slow, float(js) / maxf(1, all[team].size() * reps),
			float(ss) / maxf(1, all[team].size() * reps), worst, float(bots[0].ledge_jump)])
	print("ROUTES in %.0f s real" % ((Time.get_ticks_msec() - t_real) / 1000.0))

## The Cat bot (thinking) on its lineup spot against you at the lineup spot; the Corgi bot is taken out (parked at its
## base, out of game.pets). Every kill puts both back on their spots; the score and the clock are held so the match runs on.
func _ttk(game: Node) -> void:
	var you: Node = game.player
	var cat: Node = null
	for p in game.pets:
		if p.team == 1:
			cat = p
	var corgi_bot: Node = game.pets.filter(func(p): return p != you and p.team == 0)[0]
	game.pets.erase(corgi_bot)
	corgi_bot.respawn(game.spawns[0][15], 0.0)
	var cat_spot: Vector3 = cat.global_position
	var you_spot: Vector3 = you.global_position
	var you_yaw: float = you.yaw
	var rng := RandomNumberGenerator.new()
	for mode in ["still", "strafing"]:
		var t_kill: Array = []
		var t_fire: Array = []
		var hits := 0
		var shots := 0
		var cuts := 0
		var moved := 0.0
		var game_t := 0.0
		for i in n:
			_reseed(game, seed0 + i)
			rng.seed = seed0 + i
			game._respawns.clear()
			you.respawn(you_spot, you_yaw)
			you.cam_yaw = you_yaw
			you.shield = 0.0
			cat.respawn(cat_spot, game._yaw_to(cat_spot, you_spot))
			cat.think = true
			var t0: float = game.elapsed
			var first := -1.0
			var flip := 0.0
			var left := true
			var fired := [0, 0]
			var on_fire := func(res: Dictionary) -> void:
				fired[0] += 1
				if res.get("target") == you:
					fired[1] += 1
			cat.rifle.fired.connect(on_fire)
			while you.alive and game.elapsed - t0 < 20.0:
				game.score = [0, 0]
				game.time_left = T.MATCH_TIME
				if mode == "strafing":
					flip -= 1.0 / 60.0
					if flip <= 0.0:
						left = not left
						flip = rng.randf_range(0.5, 1.0)
						Input.action_release("move_right" if left else "move_left")
						Input.action_press("move_left" if left else "move_right")
				var was: Vector3 = you.global_position
				await physics_frame
				moved += Vector2(you.global_position.x - was.x, you.global_position.z - was.z).length()
				game_t += 1.0 / 60.0
				if first < 0.0 and fired[0] > 0:
					first = game.elapsed - t0
			for a in ["move_left", "move_right"]:
				Input.action_release(a)
			cat.rifle.fired.disconnect(on_fire)
			cat.think = false
			shots += fired[0]
			hits += fired[1]
			if you.alive:
				cuts += 1
			else:
				t_kill.append(game.elapsed - t0)
				t_fire.append(game.elapsed - t0 - first)
		print("TTK %.0f m, you %s: %d/%d kills · time to kill %s s (from exposure, incl. reaction) · %s s from the first shot · hit rate %s (%d/%d) · not killed in 20 s: %d · your mean speed %.1f m/s" % [
			ttk, mode, t_kill.size(), n, _mean_s(t_kill), _mean_s(t_fire), _pct(hits, shots), hits, shots, cuts,
			moved / maxf(game_t, 0.001)])

func _duel(game: Node) -> void:
	var corgi: Node = game.pets.filter(func(p): return p.team == 0)[0]
	var cat: Node = game.pets.filter(func(p): return p.team == 1)[0]
	game._place_lineup(duel)
	var spot: Vector3 = game.lineup_spot + Vector3(0, 0.05, 0)
	var c: Vector3 = game.slab.center + Vector3(0, 0.05, 0)
	print("DUEL target spot (%.1f, %.1f), %.1f m from the slab's centre" % [spot.x, spot.z,
		Vector2(spot.x - c.x, spot.z - c.z).length()])
	for pair in [[corgi, cat], [cat, corgi]]:
		var shooter: Node = pair[0]
		var target: Node = pair[1]
		var shots := 0
		var hits := 0
		var heads := 0
		var ttk: Array = []
		var cut := 0
		for i in n:
			_reseed(game, seed0 + i)
			game._respawns.clear()
			target.respawn(spot, game._yaw_to(spot, c))
			target.think = false
			target.shield = 0.0
			shooter.respawn(c, game._yaw_to(c, spot))
			shooter.think = true
			var f := [0, 0, 0]
			var on_fire := func(res: Dictionary) -> void:
				f[0] += 1
				if res.get("target") == target:
					f[1] += 1
					if res.get("head", false):
						f[2] += 1
			shooter.rifle.fired.connect(on_fire)
			var t0: float = game.elapsed
			while target.alive and game.elapsed - t0 < 20.0:
				game.score = [0, 0]
				game.time_left = T.MATCH_TIME
				await physics_frame
			shooter.rifle.fired.disconnect(on_fire)
			shots += f[0]
			hits += f[1]
			heads += f[2]
			if target.alive:
				cut += 1
			else:
				ttk.append(game.elapsed - t0)
		print("DUEL %s bot shooting a still %s at %.0f m: %d/%d kills · time to kill %s s · hit rate %s (%d/%d) · head hits %d" % [
			SIDE[shooter.team], SIDE[target.team], duel, ttk.size(), n, _mean_s(ttk), _pct(hits, shots), hits, shots, heads])

func _holder(game: Node) -> void:
	var you: Node = game.player
	var cat: Node = game.pets.filter(func(p): return p != you)[0]
	var c: Vector3 = game.slab.center
	var where := {"inner": 0.0, "band": 0.0, "lip": 0.0, "far": 0.0}
	var flips := 0
	var pts_after := 0
	var watched := 0.0
	var arrived := 0
	for i in n:
		_reseed(game, seed0 + i)
		game.start_match()
		you.respawn(c + Vector3(0, 0.1, 0), game._yaw_to(c, cat.global_position))
		var t0: float = game.elapsed
		var t_seen := -1.0
		var pts0 := 0
		var was_contested := false
		var w := {"inner": 0.0, "band": 0.0, "lip": 0.0, "far": 0.0}
		var f := 0
		while game.playing() and game.elapsed - t0 < holder:
			you.shield = 10.0
			await physics_frame
			if t_seen < 0.0 and cat.target == you and cat.target_visible:
				t_seen = game.elapsed
				pts0 = game.score[0]
			if t_seen < 0.0:
				continue
			var p: Vector3 = cat.global_position
			var k := "far"
			if _inside(game.slab, p, MARGIN):
				k = "inner"
			elif game.slab.contains(p):
				k = "band"
			elif _lip(game.slab, p):
				k = "lip"
			w[k] += 1.0 / 60.0
			var con: bool = game.slab_state.contested
			if con and not was_contested:
				f += 1
			was_contested = con
		var tot := 0.0
		for k in w:
			where[k] += w[k]
			tot += w[k]
		watched += tot
		flips += f
		if t_seen >= 0.0:
			arrived += 1
			pts_after += game.score[0] - pts0
		print("HOLDER trial %d: first sight at %.1f s · bot inside the margin %s · edge band %s · lip %s · farther %s · contested %d times · your points after its first sight %d" % [
			i + 1, t_seen - t0 if t_seen >= 0.0 else -1.0, _pct_f(w.inner, tot), _pct_f(w.band, tot), _pct_f(w.lip, tot),
			_pct_f(w.far, tot), f, game.score[0] - pts0 if t_seen >= 0.0 else 0])
	print("HOLDER %d trials of %.0f s, %.0f s watched: Cat bot inside the margin %s · edge band (within %.0f m of the edge) %s · on the lip %s · farther %s · contested %.1f times per trial · your points after its first sight %.1f per trial" % [
		n, holder, watched, _pct_f(where.inner, watched), MARGIN, _pct_f(where.band, watched), _pct_f(where.lip, watched),
		_pct_f(where.far, watched), float(flips) / maxf(1.0, n), float(pts_after) / maxf(1.0, arrived)])

## Start slots 0-1 and the respawn points per team, with the straight-line sprint time and, when match.gd keeps one
## beside the slot (CAT_SLOTS, CORGI_TRIPS, W15), the measured lone-bot trip.
func _print_slots(game: Node) -> void:
	if not game.has_method("start_slots"):
		return
	var cm: Dictionary = (game.get_script() as Script).get_script_constant_map()
	for t in 2:
		var out: Array = []
		var sl: Array = game.start_slots(t)
		for k in mini(2, sl.size()):
			out.append("slot %d (%.0f, %.0f) line %.2f s%s" % [k, sl[k].x, sl[k].z, _line_s(game, sl[k], t),
				_measured(cm, game, t, sl[k], "start", k)])
		var rs = game.get("respawn_slots")
		if rs is Array and not rs[t].is_empty():
			var ts: Array = []
			for j in rs[t].size():
				ts.append("(%.0f, %.0f) line %.2f s%s" % [rs[t][j].x, rs[t][j].z, _line_s(game, rs[t][j], t),
					_measured(cm, game, t, rs[t][j], "respawn", j)])
			out.append("respawns " + ", ".join(ts))
		print("SLOTS %s · %s" % [SIDE[t], " · ".join(out)])

static func _line_s(game: Node, p: Vector3, t: int) -> float:
	return Vector2(p.x - game.slab.center.x, p.z - game.slab.center.z).length() / float(T.MOVE[t].sprint)

static func _measured(cm: Dictionary, game: Node, t: int, p: Vector3, kind: String, k: int) -> String:
	if t == 1:
		for e in cm.get("CAT_SLOTS", {}).get(kind, []):
			if absf(float(e.x) - p.x) < 0.3 and absf(float(e.z) - p.z) < 0.3:
				return ", measured %.2f s" % float(e.trip)
		return ""
	var tr: Array = cm.get("CORGI_TRIPS", {}).get(kind, [])
	return ", measured %.2f s" % float(tr[k]) if k < tr.size() else ""

func _reseed(game: Node, s: int) -> void:
	seed(s)
	for p in game.pets:
		if p.get("rng") is RandomNumberGenerator:
			p.rng.seed = hash("%d/%s" % [s, p.name])
			p.react = p.rng.randf_range(0.4, 0.7)
			p._think_t = p.rng.randf() * 0.1
			p._burst = 6
			p._pause = 0.0
			p._strafe = 1.0
			p._strafe_t = 0.0
			p._stuck_t = 0.0
			p._heard = null
			p._heard_t = 0.0
			p.lost = 0.0
		p.rifle.rng.seed = hash("rifle %d/%s" % [s, p.name])
		p._jump_buffer = 0.0
		p._air_time = 0.0
		p._jump_held = false

func _match(game: Node, s: int) -> Dictionary:
	_reseed(game, s)
	game.start_match()
	var r := {"seed": s, "downs": [0, 0], "falls": [0, 0], "on": [0.0, 0.0], "hold": [0.0, 0.0], "contested": 0.0,
		"shots": [0, 0], "hits": [0, 0], "dmg": [0.0, 0.0], "first": [-1.0, -1.0], "route": [[], []],
		"died_en_route": [0, 0], "def_kills": [0, 0], "kill_d": [[], []], "log": [], "pet_on": [0.0, 0.0],
		"inner": [0.0, 0.0], "lip_fight": [0.0, 0.0], "exits": [0, 0], "jump_bins": [[0, 0, 0, 0], [0, 0, 0, 0]],
		"jump_fight": [0, 0], "air": [0.0, 0.0], "air_near": [0.0, 0.0], "sh_air": [0, 0], "hit_air": [0, 0],
		"sh_gnd": [0, 0], "hit_gnd": [0, 0], "death_bins": [[0, 0, 0, 0], [0, 0, 0, 0]], "death_air": [0, 0],
		"band": [], "band_contact": 0.0, "stall_bins": [[0, 0, 0, 0], [0, 0, 0, 0]]}
	var life := {}
	for p in game.pets:
		life[p] = {"t0": 0.0, "reached": false, "alive": true, "on": false, "j": int(p.get("jumps")) if p.get("jumps") != null else 0,
			"b_in": -1.0, "b_out": -1.0, "stall": 0.0}
	var cons: Array = []
	var on_down := func(pet: Node, killer: Node) -> void:
		var t: float = game.elapsed
		if killer == null or killer == pet:
			r.falls[pet.team] += 1
		else:
			r.downs[killer.team] += 1
			var d: float = killer.global_position.distance_to(pet.global_position)
			r.kill_d[killer.team].append(d)
			if game.slab.contains(killer.global_position) and not game.slab.contains(pet.global_position):
				r.def_kills[killer.team] += 1
			r.log.append("%.2f %s > %s %.1f m%s" % [t, killer.display_name, pet.display_name, d,
				" · victim %.0f m from the slab%s" % [_flat_d(game, pet.global_position), ", airborne" if not pet.is_on_floor() else ""] if trace else ""])
		var vd := _flat_d(game, pet.global_position)
		r.death_bins[pet.team][_bin(vd)] += 1
		if not pet.is_on_floor():
			r.death_air[pet.team] += 1
		if not life[pet].reached:
			r.died_en_route[pet.team] += 1
	game.pet_down.connect(on_down)
	cons.append([game.pet_down, on_down])
	for p in game.pets:
		var team: int = p.team
		var shooter: Node = p
		var on_fire := func(res: Dictionary) -> void:
			r.shots[team] += 1
			var hit: bool = res.get("target") != null
			if hit:
				r.hits[team] += 1
				r.dmg[team] += float(res.get("damage", 0.0))
			var tg = shooter.get("target")
			if tg != null and is_instance_valid(tg):
				var k := "air" if not tg.is_on_floor() else "gnd"
				r["sh_" + k][team] += 1
				if hit:
					r["hit_" + k][team] += 1
		p.rifle.fired.connect(on_fire)
		cons.append([p.rifle.fired, on_fire])
	var dt := 1.0 / 60.0
	while game.playing():
		await physics_frame
		if not game.playing():
			break
		var c: Array = game.slab_state.counts
		for t in 2:
			if c[t] > 0:
				r.on[t] += dt
				if r.first[t] < 0.0:
					r.first[t] = game.elapsed
		if game.slab_state.holder >= 0:
			r.hold[game.slab_state.holder] += dt
		if game.slab_state.contested:
			r.contested += dt
		for p in game.pets:
			var l: Dictionary = life[p]
			var jn = p.get("jumps")
			if jn != null and int(jn) > int(l.j):
				r.jump_bins[p.team][_bin(_flat_d(game, p.global_position))] += int(jn) - int(l.j)
				var tg = p.get("target")
				if tg != null and tg.alive and p.get("target_visible"):
					r.jump_fight[p.team] += int(jn) - int(l.j)
				l.j = int(jn)
			if p.alive and not p.is_on_floor():
				r.air[p.team] += dt
				if _flat_d(game, p.global_position) < 30.0:
					r.air_near[p.team] += dt
			if p.alive and not l.alive:
				l.t0 = game.elapsed
				l.reached = false
				l.b_in = -1.0
				l.b_out = -1.0
			if trace and p.alive:
				var hs := Vector2(p.velocity.x, p.velocity.z).length()
				if hs < 0.6 and not game.slab.contains(p.global_position):
					l.stall += dt
					if l.stall >= 0.6 and l.stall - dt < 0.6:
						r.stall_bins[p.team][_bin(_flat_d(game, p.global_position))] += 1
				else:
					l.stall = 0.0
				if p.team == 0:
					var sl := _path_s(p.global_position)
					if l.b_in < 0.0 and sl >= PATH_S.x and sl < PATH_S.y:
						l.b_in = game.elapsed
					if l.b_in >= 0.0 and l.b_out < 0.0:
						if sl >= PATH_S.y:
							l.b_out = game.elapsed
							r.band.append(l.b_out - l.b_in)
						else:
							for q in game.pets:
								if q != p and q.team == 0 and q.alive and q.global_position.distance_to(p.global_position) < 1.5:
									r.band_contact += dt
									break
			l.alive = p.alive
			if p.alive and not l.reached and game.slab.contains(p.global_position):
				l.reached = true
				r.route[p.team].append(game.elapsed - l.t0)
			var on: bool = p.alive and game.slab.contains(p.global_position)
			if on:
				r.pet_on[p.team] += dt
				if _inside(game.slab, p.global_position, MARGIN):
					r.inner[p.team] += dt
			elif p.alive:
				if l.on:
					r.exits[p.team] += 1
				var tg = p.get("target")
				if tg != null and tg.alive and p.get("target_visible") and game.slab.contains(tg.global_position) \
						and _lip(game.slab, p.global_position):
					r.lip_fight[p.team] += dt
			l.on = on
		if max_game > 0.0 and game.elapsed >= max_game:
			break
	for k in cons:
		k[0].disconnect(k[1])
	r["winner"] = game.winner if game.over() else -2
	r["score"] = game.score.duplicate()
	r["time"] = game.elapsed
	print("MATCH %s seed %d · %s · %d-%d in %.1f s · takedowns %d-%d (falls %d-%d) · on slab %.0f-%.0f s · held %.0f-%.0f s · contested %.0f s · hit rate %s-%s (%d/%d, %d/%d) · first on slab %.1f-%.1f s · spawn-to-slab %s-%s s · died en route %d-%d · kills from the slab %d-%d" % [
		fmt, s, _wname(r.winner), r.score[0], r.score[1], r.time, r.downs[0], r.downs[1], r.falls[0], r.falls[1],
		r.on[0], r.on[1], r.hold[0], r.hold[1], r.contested, _pct(r.hits[0], r.shots[0]), _pct(r.hits[1], r.shots[1]),
		r.hits[0], r.shots[0], r.hits[1], r.shots[1], r.first[0], r.first[1], _mean_s(r.route[0]), _mean_s(r.route[1]),
		r.died_en_route[0], r.died_en_route[1], r.def_kills[0], r.def_kills[1]])
	print("  slab position (Corgi-Cat) · %.0f m from the edge %s-%s of slab time · fighting a holder from the lip %.1f-%.1f s · steps off the slab alive %d-%d" % [
		MARGIN, _pct_f(r.inner[0], r.pet_on[0]), _pct_f(r.inner[1], r.pet_on[1]), r.lip_fight[0], r.lip_fight[1],
		r.exits[0], r.exits[1]])
	if trace:
		print("  trace (Corgi | Cat) · jumps by distance <20/20-60/60-100/100+ m %s | %s, in a fight %d | %d · airborne %.1f | %.1f s (within 30 m %.1f | %.1f s) · hit rate on airborne targets %s (%d) | %s (%d), on grounded %s (%d) | %s (%d) · deaths by distance %s | %s, airborne %d | %d" % [
			str(r.jump_bins[0]), str(r.jump_bins[1]), r.jump_fight[0], r.jump_fight[1], r.air[0], r.air[1], r.air_near[0],
			r.air_near[1], _pct(r.hit_air[0], r.sh_air[0]), r.sh_air[0], _pct(r.hit_air[1], r.sh_air[1]), r.sh_air[1],
			_pct(r.hit_gnd[0], r.sh_gnd[0]), r.sh_gnd[0], _pct(r.hit_gnd[1], r.sh_gnd[1]), r.sh_gnd[1],
			str(r.death_bins[0]), str(r.death_bins[1]), r.death_air[0], r.death_air[1]])
		print("  trace band (Corgi lives crossing %.0f-%.0f m of the slab path) n %d mean %s s · with a teammate within 1.5 m %.1f s · stalls by distance %s | %s" % [
			PATH_S.x, PATH_S.y, r.band.size(), _mean_s(r.band), r.band_contact, str(r.stall_bins[0]), str(r.stall_bins[1])])
	if events:
		for e in r.log:
			print("  ", e)
	return r

## The slab path (src/shared/world/lot/layout.ts SLAB_PATH): the line from Corgi spawn 0 (-74, -123) to the slab's
## centre; its ramp and trench notches lie between PATH_S.x and PATH_S.y m along it.
const PATH_A := Vector2(-74.0, -123.0)
const PATH_B := Vector2(0.0, 0.0)
const PATH_S := Vector2(26.0, 64.0)

static func _path_s(p: Vector3) -> float:
	var d := (PATH_B - PATH_A).normalized()
	return (Vector2(p.x, p.z) - PATH_A).dot(d)

static func _flat_d(game: Node, p: Vector3) -> float:
	return Vector2(p.x - game.slab.center.x, p.z - game.slab.center.z).length()

static func _bin(d: float) -> int:
	for i in BINS.size():
		if d < BINS[i]:
			return i
	return BINS.size()

func _summary(rows: Array, real_s: float) -> void:
	var wins := [0, 0]
	var draws := 0
	var margin := 0.0
	var tot := {"downs": [0, 0], "shots": [0, 0], "hits": [0, 0], "on": [0.0, 0.0], "hold": [0.0, 0.0], "route": [[], []],
		"first": [[], []], "kill_d": [[], []], "def_kills": [0, 0], "died_en_route": [0, 0], "pet_on": [0.0, 0.0],
		"inner": [0.0, 0.0], "lip_fight": [0.0, 0.0], "exits": [0, 0]}
	var game_s := 0.0
	for r in rows:
		if r.winner == 0 or r.winner == 1:
			wins[r.winner] += 1
		else:
			draws += 1
		margin += float(r.score[0] - r.score[1])
		game_s += r.time
		for t in 2:
			for k in ["downs", "shots", "hits", "def_kills", "died_en_route", "pet_on", "inner", "lip_fight", "exits"]:
				tot[k][t] += r[k][t]
			tot.on[t] += r.on[t]
			tot.hold[t] += r.hold[t]
			tot.route[t].append_array(r.route[t])
			tot.kill_d[t].append_array(r.kill_d[t])
			if r.first[t] >= 0.0:
				tot.first[t].append(r.first[t])
	var m := rows.size()
	var ci := _wilson(wins[1], m)
	print("SUMMARY %s n %d · Corgi wins %d · Cat wins %d · draws %d · Cat win share %.0f%% (95%% CI %.0f-%.0f%%) · mean margin (Corgi - Cat) %+.1f" % [
		fmt, m, wins[0], wins[1], draws, 100.0 * wins[1] / maxf(1.0, m), 100.0 * ci.x, 100.0 * ci.y, margin / maxf(1.0, m)])
	print("SUMMARY %s per side (Corgi-Cat) · takedowns %d-%d · hit rate %s-%s · on slab %.0f-%.0f s · held %.0f-%.0f s · first on slab %s-%s s · spawn-to-slab %s-%s s (n %d-%d) · died en route %d-%d · kills from the slab %d-%d · kill distance %s-%s m" % [
		fmt, tot.downs[0], tot.downs[1], _pct(tot.hits[0], tot.shots[0]), _pct(tot.hits[1], tot.shots[1]),
		tot.on[0], tot.on[1], tot.hold[0], tot.hold[1], _mean_s(tot.first[0]), _mean_s(tot.first[1]),
		_mean_s(tot.route[0]), _mean_s(tot.route[1]), tot.route[0].size(), tot.route[1].size(),
		tot.died_en_route[0], tot.died_en_route[1], tot.def_kills[0], tot.def_kills[1], _mean_s(tot.kill_d[0]), _mean_s(tot.kill_d[1])])
	print("SUMMARY %s slab position (Corgi-Cat) · %.0f m from the edge %s-%s of %.0f-%.0f pet-s on the slab · fighting a holder from the lip %.0f-%.0f s (%.1f s per match) · steps off the slab alive %d-%d (%.1f per match)" % [
		fmt, MARGIN, _pct_f(tot.inner[0], tot.pet_on[0]), _pct_f(tot.inner[1], tot.pet_on[1]), tot.pet_on[0], tot.pet_on[1],
		tot.lip_fight[0], tot.lip_fight[1], (tot.lip_fight[0] + tot.lip_fight[1]) / maxf(1.0, m), tot.exits[0], tot.exits[1],
		(tot.exits[0] + tot.exits[1]) / maxf(1.0, m)])
	if trace:
		var tj := [[0, 0, 0, 0], [0, 0, 0, 0]]
		var td := [[0, 0, 0, 0], [0, 0, 0, 0]]
		var tt := {"jump_fight": [0, 0], "air": [0.0, 0.0], "air_near": [0.0, 0.0], "sh_air": [0, 0], "hit_air": [0, 0],
			"sh_gnd": [0, 0], "hit_gnd": [0, 0], "death_air": [0, 0]}
		var tsb := [[0, 0, 0, 0], [0, 0, 0, 0]]
		var band: Array = []
		var contact := 0.0
		for r in rows:
			band.append_array(r.band)
			contact += r.band_contact
			for t in 2:
				for b in 4:
					tj[t][b] += r.jump_bins[t][b]
					td[t][b] += r.death_bins[t][b]
					tsb[t][b] += r.stall_bins[t][b]
				for k in tt:
					tt[k][t] += r[k][t]
		print("SUMMARY %s trace band · Corgi lives crossing the slab path's %.0f-%.0f m: n %d, mean %s s · with a teammate within 1.5 m %.0f s in all · stalls by distance <20/20-60/60-100/100+ m %s | %s" % [
			fmt, PATH_S.x, PATH_S.y, band.size(), _mean_s(band), contact, str(tsb[0]), str(tsb[1])])
		print("SUMMARY %s trace (Corgi | Cat) · jumps by distance <20/20-60/60-100/100+ m %s | %s, in a fight %d | %d · airborne %.0f | %.0f s (within 30 m %.0f | %.0f s) · hit rate on airborne targets %s (%d shots) | %s (%d), on grounded %s (%d) | %s (%d) · deaths by distance %s | %s, airborne %d | %d" % [
			fmt, str(tj[0]), str(tj[1]), tt.jump_fight[0], tt.jump_fight[1], tt.air[0], tt.air[1], tt.air_near[0],
			tt.air_near[1], _pct(tt.hit_air[0], tt.sh_air[0]), tt.sh_air[0], _pct(tt.hit_air[1], tt.sh_air[1]), tt.sh_air[1],
			_pct(tt.hit_gnd[0], tt.sh_gnd[0]), tt.sh_gnd[0], _pct(tt.hit_gnd[1], tt.sh_gnd[1]), tt.sh_gnd[1],
			str(td[0]), str(td[1]), tt.death_air[0], tt.death_air[1]])
	print("SUMMARY %s %.0f s of game time in %.0f s real (x%.1f)" % [fmt, game_s, real_s, game_s / maxf(0.001, real_s)])

## In the slab's score volume (slab.gd contains()) and at least `margin` m inside every edge of its square.
static func _inside(slab: Node, p: Vector3, margin: float) -> bool:
	return slab.contains(p) and absf(p.x - slab.center.x) <= slab.size.x * 0.5 - margin \
		and absf(p.z - slab.center.z) <= slab.size.y * 0.5 - margin

## Outside the volume, within LIP m of its square (the y window of contains()).
static func _lip(slab: Node, p: Vector3) -> bool:
	var out := maxf(absf(p.x - slab.center.x) - slab.size.x * 0.5, absf(p.z - slab.center.z) - slab.size.y * 0.5)
	return out > 0.0 and out <= LIP and p.y > slab.center.y - 1.0 and p.y < slab.center.y + 3.0

static func _pct_f(a: float, b: float) -> String:
	return "%.0f%%" % (100.0 * a / b) if b > 0.0 else "-"

static func _wname(w: int) -> String:
	return {0: "CORGI", 1: "CAT", -1: "DRAW", -2: "CUT"}[w]

static func _pct(a: int, b: int) -> String:
	return "%.0f%%" % (100.0 * a / b) if b > 0 else "-"

static func _mean_s(a: Array) -> String:
	if a.is_empty():
		return "-"
	var s := 0.0
	for v in a:
		s += float(v)
	return "%.1f" % (s / a.size())

## 95 % Wilson score interval for k successes in m trials.
static func _wilson(k: int, m: int) -> Vector2:
	if m == 0:
		return Vector2(0, 1)
	var z := 1.96
	var p := float(k) / m
	var den := 1.0 + z * z / m
	var c := (p + z * z / (2.0 * m)) / den
	var h := z * sqrt(p * (1.0 - p) / m + z * z / (4.0 * m * m)) / den
	return Vector2(maxf(0.0, c - h), minf(1.0, c + h))

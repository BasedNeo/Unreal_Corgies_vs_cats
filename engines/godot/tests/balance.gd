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
## G-BAL lab (W17, docs/qa/w17/BOT-ROLES.md "G-BAL"): one lab bot per team and species (team = side, species = body,
## hitbox, eye, speed); the match's own bots are frozen and parked. n trials each, seeds S + i.
## --hitrate          one-way fire, every shooter species x target species, at --dists (default 10,20,30 m) on level open
##                    ground, --stance still (both pinned) and moving (both in a +-2.5 m lane at their run speed), --secs
##                    s per trial; plus the pure geometry (20000 rays at the target's aim point)
## --duel2            two-way duels, a Corgi and a Cat, both mortal, the spots swapped every other trial; --stance also
##                    takes "free" (each bot moves itself)
## --exposure         a lone bot runs from each start slot and respawn point; seconds its chest is in sight of an enemy
##                    holder's eye on the slab, by distance from the slab
## --standoff         a Corgi and a Cat on opposite slab edges (facing each other or away, sides swapped): wins, first
##                    sight, first shot, hit rates, how often the aim is outside bot.gd FIRE_CONE
## --arrival          one species holds the slab's middle, the other arrives from 16 m on its own way in, then swapped
## --brawl            two of each species on the slab, no respawns, until one side is down
## --lab-patch a,b    DIAGNOSTIC ONLY, never a fix: the Cats (lab bots, or a match's Cat bots with --format) take a
##                    Corgi attribute: move (run, accel, decel), hitbox, eye, eyeonly, chestonly (the last three need a
##                    lab bot). eye / eyeonly / chestonly set a Cat's eye and the point others aim at on it to the
##                    Corgi's pet.gd heights (0.936 / 0.660 m). Since G-BAL every bot already aims with those heights
##                    (bot.gd AIM_EYE, AIM_CHEST), so on today's bot.gd they change nothing; their W17 numbers were
##                    measured on f1a79c5's bot.gd. own: every lab bot looks from its own species' pet.gd eye (0.78 h)
##                    and is aimed at its own pet.gd chest (0.55 h), the aim as shipped before G-BAL
## --lab-order cat    the lab Cats enter the tree first (physics runs in tree order; match.gd adds the Corgis first)
## Per match: format, seed, winner, score, takedowns per side, seconds with a pet of each side on the slab, seconds
## each side held it alone (scored), shots / hits / hit rate per side, first arrival on the slab per side, and the
## mean spawn-to-slab time per life.
## 2v2 also prints a `roles ·` line per match and a `SUMMARY 2v2 roles` line (W15, W17): per team and bot role (bot.gd
## HOLD / APPROACH), the time to the slab, seconds on it, and an APPROACH bot's alive time split four ways
## (_role_where): at its post (within POST_R m), approaching (on its way there: not stepping on, off the slab),
## stepping on, and on the slab while bound for its post (the W15 trap holds it there); the spawn-to-post time; and per
## team, of the time both its bots are alive, the share with one on the slab and the other at its post or approaching.
const T := preload("res://game/tuning.gd")
const Bot := preload("res://game/bot.gd")
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
## G-BAL lab modes (see the header).
var hitrate := false
var duel2 := false
var exposure := false
var standoff := false
var arrival := false
var brawl := false
var dists: Array = [10.0, 20.0, 30.0]
var secs := 6.0
var stances: Array = ["still", "moving"]
var lab_rev := false  # --lab-order cat: the lab pets enter the tree Cat-side first (physics runs in tree order)
var lab_patch: Array = []  # --lab-patch: diagnostic only, never a fix (see the header)

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
			"--hitrate": hitrate = true
			"--duel2": duel2 = true
			"--exposure": exposure = true
			"--standoff": standoff = true
			"--arrival": arrival = true
			"--brawl": brawl = true
			"--dists": dists = Array(v.split(",")).map(func(x): return float(x))
			"--secs": secs = float(v)
			"--stance": stances = Array(v.split(","))
			"--lab-order": lab_rev = v == "cat"
			"--lab-patch": lab_patch = Array(v.split(","))

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
	if duel > 0.0 or hitrate or duel2 or exposure or standoff or arrival or brawl:
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
	if not lab_patch.is_empty() and not (hitrate or duel2 or exposure or standoff or arrival or brawl):
		for p in game.pets:  # diagnostic only: the match's Cat bots take Corgi attributes (see --lab-patch)
			if p.team == 1:
				_patch_cat(p)
		print("BALANCE diagnostic patch on the Cat bots: " + ", ".join(lab_patch))
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
	if hitrate or duel2 or exposure or standoff or arrival or brawl:
		await _gbal(game)
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
		"band": [], "band_contact": 0.0, "stall_bins": [[0, 0, 0, 0], [0, 0, 0, 0]], "roles": {}}
	var life := {}
	for p in game.pets:
		life[p] = {"t0": 0.0, "reached": false, "alive": true, "on": false, "j": int(p.get("jumps")) if p.get("jumps") != null else 0,
			"b_in": -1.0, "b_out": -1.0, "stall": 0.0, "role": p.get("role"), "at_post": false}
		if p.get("role") != null:
			_rstat(r, p.team, int(p.get("role"))).lives += 1
	r["split"] = [[0.0, 0.0], [0.0, 0.0]]  # per team: [s with both of its bots alive, s of that split HOLD on / APPROACH out]
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
		if life[pet].role != null:
			_rstat(r, pet.team, int(life[pet].role)).deaths += 1
		if killer != null and killer != pet and life.has(killer) and life[killer].role != null:
			_rstat(r, killer.team, int(life[killer].role)).kills += 1
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
				l.at_post = false
				l.b_in = -1.0
				l.b_out = -1.0
				l.role = p.get("role")
				if l.role != null:
					_rstat(r, p.team, int(l.role)).lives += 1
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
				if l.role != null:
					var rs: Dictionary = _rstat(r, p.team, int(l.role))
					rs.reached += 1
					rs.tts.append(game.elapsed - l.t0)
			if p.alive and l.role != null:
				var rs2: Dictionary = _rstat(r, p.team, int(l.role))
				rs2.alive += dt
				var on_s: bool = game.slab.contains(p.global_position)
				if on_s:
					rs2.on += dt
					rs2.stood = true
				# W17: where an APPROACH bot's alive time goes. At its post (within POST_R m of it, flat), else
				# approaching (on its way to the post: not stepping on, off the slab), stepping on (going to or on the
				# slab for its reason), or held on the slab while its goal is the post (the W15 trap).
				match _role_where(game, p):
					"post":
						rs2.post += dt
						if not l.at_post:
							l.at_post = true
							rs2.ptts.append(game.elapsed - l.t0)
					"approach":
						rs2.approach += dt
					"stepon":
						rs2.stepon += dt
					"held":
						rs2.held += dt
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
		for t in 2:  # W17: a team of two bots, both alive: one holds the slab while the other is at its post or approaching
			var mine: Array = game.pets.filter(func(q): return q.team == t and q.get("role") != null)
			if mine.size() != 2 or not (mine[0].alive and mine[1].alive):
				continue
			r.split[t][0] += dt
			var on0: bool = game.slab.contains(mine[0].global_position)
			var on1: bool = game.slab.contains(mine[1].global_position)
			if on0 != on1 and _role_where(game, mine[1] if on0 else mine[0]) in ["post", "approach"]:
				r.split[t][1] += dt
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
	if fmt == "2v2" and not r.roles.is_empty():
		print("  roles · " + _role_line(r.roles, 1) + " · " + _split_line(r.split))
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

## Per team and bot role (bot.gd role: 0 HOLD, 1 APPROACH): lives, lives that reached the slab and their
## spawn-to-slab times, seconds on the slab, whether it stood on the slab this match, seconds at its post, kills, deaths.
## W17: an APPROACH bot's alive time split four ways (_role_where): at the post, approaching, stepping on, held on the
## slab; and the spawn-to-post time of the lives that reached the post.
static func _rstat(r: Dictionary, team: int, role: int) -> Dictionary:
	var k := "%d:%d" % [team, role]
	if not r.roles.has(k):
		r.roles[k] = {"lives": 0, "reached": 0, "tts": [], "on": 0.0, "stood": false, "post": 0.0, "kills": 0, "deaths": 0,
			"alive": 0.0, "approach": 0.0, "stepon": 0.0, "held": 0.0, "ptts": []}
	return r.roles[k]

const ROLE_NAMES := ["HOLD", "APPROACH"]
## "At the post": within this many metres (flat) of bot.gd push_point (W15's measure).
const POST_R := 3.0

## Where a live bot is, for its role: "post" (within POST_R m of its post), "approach" (APPROACH on its way to the
## post: not stepping on, off the slab), "stepon" (APPROACH stepping on), "held" (APPROACH whose goal is its post but
## standing on the slab: the W15 trap), or "" (HOLD, or no role).
static func _role_where(game: Node, p: Node) -> String:
	if p.get("role") == null:
		return ""
	var pp = p.get("push_point")
	if pp is Vector3 and pp != Vector3.INF and Vector2(pp.x - p.global_position.x, pp.z - p.global_position.z).length() < POST_R:
		return "post"
	if int(p.get("role")) != 1:
		return ""
	if bool(p.get("_stepping_on")):
		return "stepon"
	return "held" if game.slab.contains(p.global_position) else "approach"

static func _role_line(roles: Dictionary, n: int) -> String:
	var out: Array = []
	for k in ["0:0", "0:1", "1:0", "1:1"]:
		if not roles.has(k):
			continue
		var v: Dictionary = roles[k]
		var t := int(k.split(":")[0])
		var ro := int(k.split(":")[1])
		var where := ""
		if ro == 1:
			where = " · approaching %s · stepping on %s · held on the slab %s · post or approaching %s · spawn-to-post %s s (%d lives)" % [
				_pct_f(v.approach, v.alive), _pct_f(v.stepon, v.alive), _pct_f(v.held, v.alive),
				_pct_f(v.post + v.approach, v.alive), _mean_s(v.ptts), v.ptts.size()]
		out.append("%s %s: time to slab %s s (%d of %d lives) · on the slab %.0f s%s · stood on it in %d/%d matches · at the post %.0f s (%s of its alive time)%s · alive %.0f s · kills %d · deaths %d" % [
			SIDE[t], ROLE_NAMES[ro], _mean_s(v.tts), v.reached, v.lives, v.on, "" if n == 1 else " (%.1f per match)" % (v.on / n),
			int(v.stood_n) if v.has("stood_n") else (1 if v.stood else 0), n, v.post, _pct_f(v.post, v.alive), where,
			v.alive, v.kills, v.deaths])
	return " | ".join(out)

## Per team: of the time both its bots are alive, the share with one on the slab and the other at its post or
## approaching ("one holds, one approaches").
static func _split_line(sp: Array) -> String:
	return "split, one on the slab and one at its post or approaching, of both-alive time: Corgi %s of %.0f s | Cat %s of %.0f s" % [
		_pct_f(sp[0][1], sp[0][0]), sp[0][0], _pct_f(sp[1][1], sp[1][0]), sp[1][0]]

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
	var rt := {}
	var sp := [[0.0, 0.0], [0.0, 0.0]]
	for r in rows:
		for t in 2:
			sp[t][0] += r.split[t][0]
			sp[t][1] += r.split[t][1]
		for k in r.roles:
			var v: Dictionary = r.roles[k]
			if not rt.has(k):
				rt[k] = {"lives": 0, "reached": 0, "tts": [], "on": 0.0, "stood": false, "stood_n": 0, "post": 0.0, "kills": 0,
					"deaths": 0, "alive": 0.0, "approach": 0.0, "stepon": 0.0, "held": 0.0, "ptts": []}
			for f in ["lives", "reached", "on", "post", "kills", "deaths", "alive", "approach", "stepon", "held"]:
				rt[k][f] += v[f]
			rt[k].tts.append_array(v.tts)
			rt[k].ptts.append_array(v.ptts)
			if v.stood:
				rt[k].stood_n += 1
	if fmt == "2v2" and not rt.is_empty():
		print("SUMMARY %s roles · %s · %s" % [fmt, _role_line(rt, rows.size()), _split_line(sp)])
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

# --- G-BAL (W17): where the Cat advantage comes from ---------------------------------------------------------------
## Lab pets: one bot per team and species (team sets the side and the rifle's ally filter; species sets the body,
## hitbox, eye, speed). The match's own bots are frozen, parked at their bases and taken out of game.pets.

const SPEC := ["Corgi", "Cat"]
## Half-width of the strafe lane in --hitrate / --duel2 "moving" (each pet slides sideways at its species' run speed
## and turns back every 0.5-1.0 s or at the lane's end).
const STRAFE := 2.5

func _gbal(game: Node) -> void:
	for p in game.pets:
		p.think = false
		p.respawn(game.spawns[p.team][15], 0.0)
	game.pets = []
	var lab := {}
	var order: Array = ["00", "01", "10", "11"]
	if lab_rev:
		order.reverse()
	for key in order:
		lab[key] = _lab_pet(game, int(key[0]), int(key[1]))
	print("GBAL lab pets in tree (physics) order: " + ", ".join(order.map(func(x): return lab[x].display_name)) +
		(" · diagnostic patch on the lab Cats: " + ", ".join(lab_patch) if not lab_patch.is_empty() else ""))
	for i in 3:
		await physics_frame
	var parts: Array = []
	for sp in 2:
		var p: Node = lab["%d%d" % [sp, sp]]
		var hc: CapsuleShape3D = (p.hitbox.get_child(0) as CollisionShape3D).shape
		parts.append("%s height %.2f m, pet.gd eye %.3f m and chest %.3f m, the bot aims from %.3f m at %.3f m (as a lab bot, patches included), hitbox r %.2f h %.2f (side-on area %.3f m2, head band from %.3f m)" % [
			SPEC[sp], T.height(sp), T.height(sp) * 0.78, T.height(sp) * 0.55, p._eye().y - p.global_position.y,
			p._aim_point(p).y - p.global_position.y, hc.radius, hc.height,
			2.0 * hc.radius * (hc.height - 2.0 * hc.radius) + PI * hc.radius * hc.radius, 0.8 * T.height(sp)])
	print("GBAL pets · " + " · ".join(parts))
	if hitrate:
		await _hitrate(game, lab)
	if duel2:
		await _duel2(game, lab)
	if exposure:
		await _exposure(game, lab)
	if standoff:
		await _standoff(game, lab)
	if arrival:
		await _arrival(game, lab)
	if brawl:
		await _brawl(game, lab)

## A bot whose eye and chest heights can be set (lab only; -1 keeps pet.gd's).
## Both height pairs are overridden: pet.gd eye()/chest() (what bot.gd aimed with before G-BAL) and bot.gd
## _eye()/_aim_point() (what it aims with since). _aim_point is static; GDScript dispatches it on the calling bot's
## script, so a LabBot shooter reads the target's chest_h, and a plain bot.gd shooter keeps AIM_CHEST.
class LabBot extends "res://game/bot.gd":
	var eye_h := -1.0
	var chest_h := -1.0
	func eye() -> Vector3:
		return super.eye() if eye_h < 0.0 else global_position + Vector3(0, eye_h, 0)
	func chest() -> Vector3:
		return super.chest() if chest_h < 0.0 else global_position + Vector3(0, chest_h, 0)
	func _eye() -> Vector3:
		return super._eye() if eye_h < 0.0 else global_position + Vector3(0, eye_h, 0)
	static func _aim_point(p: Node) -> Vector3:
		var h = p.get("chest_h")
		return p.global_position + Vector3(0, float(h) if h != null and float(h) >= 0.0 else AIM_CHEST, 0)

func _lab_pet(game: Node, team: int, species: int) -> Node:
	var p = LabBot.new()
	p.configure(team, species, "%s-side %s" % [SIDE[team], SPEC[species]], game.look)
	p.name = "Lab%d%d" % [team, species]
	p.game = game
	p.think = false
	game.add_child(p)
	p.respawn(game.spawns[team][13 + species], 0.0)
	if species == 1:
		_patch_cat(p)
	if lab_patch.has("own"):
		p.eye_h = T.height(species) * 0.78
		p.chest_h = T.height(species) * 0.55
	return p

## --lab-patch on one Cat (lab pet or match bot). "eye", "eyeonly", "chestonly" need a LabBot.
func _patch_cat(p: Node) -> void:
	if lab_patch.has("move"):
		var mm: Dictionary = p.m.duplicate()
		for key in ["run", "accel", "decel"]:
			mm[key] = T.MOVE[0][key]
		p.m = mm
	if lab_patch.has("hitbox"):
		var hs: CollisionShape3D = p.hitbox.get_child(0)
		var cap := CapsuleShape3D.new()
		cap.radius = float(T.MOVE[0].radius) + 0.04
		cap.height = T.height(0) + 0.08
		hs.shape = cap
		hs.position.y = T.height(0) * 0.5
	if (lab_patch.has("eye") or lab_patch.has("eyeonly")) and p.get("eye_h") != null:
		p.eye_h = T.height(0) * 0.78
	if (lab_patch.has("eye") or lab_patch.has("chestonly")) and p.get("chest_h") != null:
		p.chest_h = T.height(0) * 0.55

## Every lab pet but `keep` back to its parking spot at its base, still (an idle one must never share a spot with
## the pair in use: its hitbox would soak their shots).
func _park(game: Node, lab: Dictionary, keep: Array) -> void:
	for p in lab.values():
		if not keep.has(p):
			p.think = false
			p.respawn(game.spawns[p.team][13 + p.species], 0.0)

func _lab_reseed(p: Node, s: int) -> void:
	p.rng.seed = hash("%d/%s" % [s, p.name])
	p.rifle.rng.seed = hash("rifle %d/%s" % [s, p.name])
	p.react = p.rng.randf_range(0.4, 0.7)
	p._think_t = p.rng.randf() * 0.1

## Puts a pet's feet on the ground at `at` (x, z) with velocity `vel` (the bot's spread reads its speed).
func _place(game: Node, p: Node, at: Vector3, vel: Vector3) -> void:
	var hit: Dictionary = game._ground_hit(at)
	p.global_position = Vector3(at.x, (hit.position.y if not hit.is_empty() else at.y) + 0.02, at.z)
	p.velocity = vel

static func _hold(game: Node) -> void:
	game.score = [0, 0]
	game.time_left = T.MATCH_TIME

## Two spots `d` m apart on level, open ground at least 10 m from the slab's centre: every ray between both species'
## eyes and feet / chest / top, from the spots and from STRAFE m to either side, is clear. [P, Q, side] or [].
func _find_line(game: Node, d: float) -> Array:
	var c: Vector3 = game.slab.center
	for r in [20.0, 28.0, 36.0, 44.0, 52.0]:
		for k in 24:
			var a := TAU * k / 24.0
			var mid: Vector3 = c + Vector3(cos(a), 0.0, sin(a)) * float(r)
			for k2 in 12:
				var b := PI * k2 / 12.0
				var dir := Vector3(cos(b), 0.0, sin(b))
				var got := _flat_line(game, mid - dir * d * 0.5, mid + dir * d * 0.5, Vector3(-dir.z, 0.0, dir.x))
				if not got.is_empty():
					return got
	return []

func _flat_line(game: Node, p: Vector3, q: Vector3, side: Vector3) -> Array:
	var c: Vector3 = game.slab.center
	var g0: Dictionary = game._ground_hit(p)
	if g0.is_empty():
		return []
	var y0: float = g0.position.y
	var n := int(ceil(p.distance_to(q)))
	for o in [-STRAFE, 0.0, STRAFE]:
		for i in n + 1:
			var x: Vector3 = p.lerp(q, float(i) / n) + side * o
			if Vector2(x.x - c.x, x.z - c.z).length() < 10.0:
				return []
			var g: Dictionary = game._ground_hit(x)
			if g.is_empty() or g.normal.y < 0.97 or absf(g.position.y - y0) > 0.3:
				return []
	var space: PhysicsDirectSpaceState3D = game.get_viewport().get_world_3d().direct_space_state
	var gp: Vector3 = g0.position
	var gq: Vector3 = game._ground_hit(q).position
	for op in [-STRAFE, 0.0, STRAFE]:
		for oq in [-STRAFE, 0.0, STRAFE]:
			for e in [T.height(0) * 0.78, T.height(1) * 0.78]:
				for h in [0.15, T.height(0) * 0.55, T.height(1) * 0.55, 1.2]:
					for pair in [[gp + side * op, gq + side * oq], [gq + side * oq, gp + side * op]]:
						var from: Vector3 = pair[0] + Vector3(0, e, 0)
						var to: Vector3 = pair[1] + Vector3(0, h, 0)
						if not space.intersect_ray(PhysicsRayQueryParameters3D.create(from, to, T.L_WORLD)).is_empty():
							return []
	return [gp, gq, side]

## A strafe lane state per pet: [offset, direction, time to the next turn].
func _strafe_step(st: Array, run: float, rng: RandomNumberGenerator, dt: float) -> void:
	st[2] -= dt
	if st[2] <= 0.0 or absf(st[0] + st[1] * run * dt) > STRAFE:
		st[1] = -st[1]
		st[2] = rng.randf_range(0.5, 1.0)
	st[0] += st[1] * run * dt

## (a) One-way fire. The shooter (team Corgi, either species) is a thinking bot; the target (team Cat, either species)
## stands or strafes, unhurt, and does not think. Per distance: first the pure geometry (20000 rays from the shooter's
## eye at the target's chest with the bot's standing spread: rifle spread_hip + bot.gd AIM_ERROR, no bloom), then the
## real bot over n trials of `secs` s, still and moving.
func _hitrate(game: Node, lab: Dictionary) -> void:
	var rng := RandomNumberGenerator.new()
	for d in dists:
		var line := _find_line(game, d)
		if line.is_empty():
			print("HITRATE %.0f m: no level, open line found" % d)
			continue
		var P: Vector3 = line[0]
		var Q: Vector3 = line[1]
		var side: Vector3 = line[2]
		print("HITRATE line %.0f m: P (%.1f, %.1f) y %.2f, Q (%.1f, %.1f) y %.2f" % [d, P.x, P.z, P.y, Q.x, Q.z, Q.y])
		for ss in 2:
			for ts in 2:
				var sh: Node = lab["0%d" % ss]
				var tg: Node = lab["1%d" % ts]
				game.pets = [sh, tg]
				_park(game, lab, [sh, tg])
				sh.respawn(P, game._yaw_to(P, Q))
				tg.respawn(Q, game._yaw_to(Q, P))
				for i in 3:
					_hold(game)
					_place(game, sh, P, Vector3.ZERO)
					_place(game, tg, Q, Vector3.ZERO)
					await physics_frame
				sh.rifle.rng.seed = 7 + ss * 2 + ts
				var eye: Vector3 = sh._eye()  # the bot's own helpers: what it aims and fires with
				var aim: Vector3 = (sh._aim_point(tg) - eye).normalized()
				var spread: float = float(T.RIFLE.spread_hip) + Bot.AIM_ERROR
				var hits := 0
				var heads := 0
				var rays := 20000
				for i in rays:
					var res: Dictionary = sh.rifle.trace(eye, sh.rifle.spread_dir(aim, spread))
					if res.target == tg:
						hits += 1
						if res.head:
							heads += 1
				print("HITRATE geometry %.0f m · %s shooter (eye %.2f m) > %s target: hit %.1f %% · head %.1f %% (%d rays, cone %.2f deg)" % [
					d, SPEC[ss], eye.y - sh.global_position.y, SPEC[ts], 100.0 * hits / rays, 100.0 * heads / rays, rays,
					rad_to_deg(spread)])
		for stance in stances:
			for ss in 2:
				for ts in 2:
					var sh: Node = lab["0%d" % ss]
					var tg: Node = lab["1%d" % ts]
					game.pets = [sh, tg]
					_park(game, lab, [sh, tg])
					var acc := {"shots": 0, "hits": 0, "heads": 0, "first": []}
					var t_fire := [-1.0]
					var on_fire := func(res: Dictionary) -> void:
						acc.shots += 1
						if t_fire[0] < 0.0:
							t_fire[0] = 0.0
						if res.get("target") == tg:
							acc.hits += 1
							if res.get("head", false):
								acc.heads += 1
					sh.rifle.fired.connect(on_fire)
					for i in n:
						seed(seed0 + i)
						rng.seed = seed0 + i
						_lab_reseed(sh, seed0 + i)
						_lab_reseed(tg, seed0 + i)
						sh.respawn(P, game._yaw_to(P, Q))
						tg.respawn(Q, game._yaw_to(Q, P))
						sh.think = true
						tg.think = false
						var lane := [[0.0, 1.0, rng.randf_range(0.5, 1.0)], [0.0, -1.0, rng.randf_range(0.5, 1.0)]]
						var t := 0.0
						var shots0: int = acc.shots
						while t < secs:
							_hold(game)
							tg.shield = 1.0
							if stance == "moving":
								_strafe_step(lane[0], float(sh.m.run), rng, 1.0 / 60.0)
								_strafe_step(lane[1], float(tg.m.run), rng, 1.0 / 60.0)
								_place(game, sh, P + side * lane[0][0], side * lane[0][1] * float(sh.m.run))
								_place(game, tg, Q + side * lane[1][0], side * lane[1][1] * float(tg.m.run))
							else:
								_place(game, sh, P, Vector3.ZERO)
								_place(game, tg, Q, Vector3.ZERO)
							await physics_frame
							t += 1.0 / 60.0
							if acc.shots > shots0 and t_fire[0] == 0.0:
								t_fire[0] = t
						if t_fire[0] > 0.0:
							acc.first.append(t_fire[0])
						t_fire[0] = -1.0
						sh.think = false
					sh.rifle.fired.disconnect(on_fire)
					print("HITRATE bot %.0f m %s · %s shooter > %s target: hit %s (%d/%d) · head hits %d · first shot %s s · %d trials of %.0f s" % [
						d, stance, SPEC[ss], SPEC[ts], _pct1(acc.hits, acc.shots), acc.hits, acc.shots, acc.heads,
						_mean_s(acc.first), n, secs])
		for p in lab.values():
			p.think = false

static func _pct1(a: int, b: int) -> String:
	return "%.1f%%" % (100.0 * a / b) if b > 0 else "-"

## (a) Two-way duels: a Corgi-side Corgi and a Cat-side Cat, both thinking and mortal, on the same two spots, the
## species swapped every other trial. Per distance and stance: wins, time to kill, hit rates, first shots.
func _duel2(game: Node, lab: Dictionary) -> void:
	var rng := RandomNumberGenerator.new()
	var c: Node = lab["00"]
	var k: Node = lab["11"]
	_park(game, lab, [c, k])
	for d in dists:
		var line := _find_line(game, d)
		if line.is_empty():
			print("DUEL2 %.0f m: no level, open line found" % d)
			continue
		var P: Vector3 = line[0]
		var Q: Vector3 = line[1]
		var side: Vector3 = line[2]
		for stance in stances:
			var wins := [0, 0]
			var wins_at := [[0, 0], [0, 0]]  # [species][spot: 0 = P, 1 = Q]
			var ttk := [[], []]
			var acc := [[0, 0, 0], [0, 0, 0]]  # per shooter species: shots, hits, heads
			var first := [[], []]
			var undecided := 0
			var cons: Array = []
			for pair in [[c, 0], [k, 1]]:
				var sp: int = pair[1]
				var me: Node = pair[0]
				var other: Node = k if me == c else c
				var f := func(res: Dictionary) -> void:
					acc[sp][0] += 1
					if res.get("target") == other:
						acc[sp][1] += 1
						if res.get("head", false):
							acc[sp][2] += 1
				me.rifle.fired.connect(f)
				cons.append([me, f])
			for i in n:
				var swap := i % 2 == 1
				var pc: Vector3 = Q if swap else P
				var pk: Vector3 = P if swap else Q
				game.pets = [c, k]
				seed(seed0 + i)
				rng.seed = seed0 + i
				_lab_reseed(c, seed0 + i)
				_lab_reseed(k, seed0 + i)
				c.respawn(pc, game._yaw_to(pc, pk))
				k.respawn(pk, game._yaw_to(pk, pc))
				c.shield = 0.0
				k.shield = 0.0
				c.think = true
				k.think = true
				var lane := [[0.0, 1.0, rng.randf_range(0.5, 1.0)], [0.0, -1.0, rng.randf_range(0.5, 1.0)]]
				var s0 := [acc[0][0], acc[1][0]]
				var t1 := [-1.0, -1.0]
				var t := 0.0
				while t < 20.0 and c.alive and k.alive:
					_hold(game)
					if stance == "free":
						pass  # both move on their own (bot.gd steering: to the slab, strafing, backing off under 7 m)
					elif stance == "moving":
						_strafe_step(lane[0], float(c.m.run), rng, 1.0 / 60.0)
						_strafe_step(lane[1], float(k.m.run), rng, 1.0 / 60.0)
						_place(game, c, pc + side * lane[0][0], side * lane[0][1] * float(c.m.run))
						_place(game, k, pk + side * lane[1][0], side * lane[1][1] * float(k.m.run))
					else:
						_place(game, c, pc, Vector3.ZERO)
						_place(game, k, pk, Vector3.ZERO)
					await physics_frame
					t += 1.0 / 60.0
					for s in 2:
						if t1[s] < 0.0 and acc[s][0] > s0[s]:
							t1[s] = t
				for s in 2:
					if t1[s] >= 0.0:
						first[s].append(t1[s])
				if c.alive == k.alive:
					undecided += 1
				else:
					var w := 0 if c.alive else 1
					wins[w] += 1
					wins_at[w][(1 if swap else 0) if w == 0 else (0 if swap else 1)] += 1
					ttk[w].append(t)
				c.think = false
				k.think = false
			for e in cons:
				e[0].rifle.fired.disconnect(e[1])
			print("DUEL2 %.0f m %s · Corgi wins %d (at P %d, at Q %d) · Cat wins %d (at P %d, at Q %d) · undecided %d · time to kill Corgi %s s, Cat %s s · hit rate Corgi %s (%d/%d, %d head), Cat %s (%d/%d, %d head) · first shot Corgi %s s, Cat %s s" % [
				d, stance, wins[0], wins_at[0][0], wins_at[0][1], wins[1], wins_at[1][0], wins_at[1][1], undecided,
				_mean_s(ttk[0]), _mean_s(ttk[1]), _pct1(acc[0][1], acc[0][0]), acc[0][1], acc[0][0], acc[0][2],
				_pct1(acc[1][1], acc[1][0]), acc[1][1], acc[1][0], acc[1][2], _mean_s(first[0]), _mean_s(first[1])])

## (b) Route exposure. A lone bot of each team runs from each of its start slots and respawn points to the slab (n
## runs per point, each with its own goal on the slab). Every tick: is its chest in sight of an enemy holder's eye
## (the enemy species' eye height over five slab points: the centre and 2 m in from it towards each corner), within
## bot.gd VIEW_DIST? Seconds by flat distance from the slab's centre, and where it was last hidden.
func _exposure(game: Node, lab: Dictionary) -> void:
	var c: Vector3 = game.slab.center
	var space: PhysicsDirectSpaceState3D = game.get_viewport().get_world_3d().direct_space_state
	var bands := [60.0, 40.0, 20.0, 8.0, 0.0]
	for team in 2:
		var runner: Node = lab["%d%d" % [team, team]]
		game.pets = [runner]
		_park(game, lab, [runner])
		var holder: Node = lab["%d%d" % [1 - team, 1 - team]]  # its eye height and aim point: the bot's own helpers
		var holder_eye: float = holder._eye().y - holder.global_position.y
		var eyes: Array = []
		for o in [Vector2(0, 0), Vector2(2, 2), Vector2(-2, 2), Vector2(2, -2), Vector2(-2, -2)]:
			var g: Dictionary = game._ground_hit(c + Vector3(o.x, 0.0, o.y))
			eyes.append((g.position if not g.is_empty() else c) + Vector3(0, holder_eye, 0))
		var pts: Array = []
		for sp in game.start_slots(team).slice(0, 2) + game.respawn_slots[team]:
			if not pts.any(func(x): return (x as Vector3).distance_to(sp) < 0.3):
				pts.append(sp)
		var tot := [0.0, 0.0, 0.0, 0.0]
		var seen := [0.0, 0.0, 0.0, 0.0]
		var last_hidden: Array = []
		var trips: Array = []
		var runs := 0
		for sp in pts:
			for r in n:
				_lab_reseed(runner, seed0 + r)
				runner.respawn(sp, game._yaw_to(sp, c))
				runner.think = true
				var t := 0.0
				var lh := -1.0
				while t < 60.0:
					_hold(game)
					await physics_frame
					t += 1.0 / 60.0
					var p: Vector3 = runner.global_position
					if game.slab.contains(p):
						break
					var dd := Vector2(p.x - c.x, p.z - c.z).length()
					if dd >= bands[0]:
						continue
					var b := 0
					while b < 3 and dd < bands[b + 1]:
						b += 1
					tot[b] += 1.0 / 60.0
					var vis := false
					for e in eyes:
						if space.intersect_ray(PhysicsRayQueryParameters3D.create(e, holder._aim_point(runner), T.L_WORLD)).is_empty():
							vis = true
							break
					if vis:
						seen[b] += 1.0 / 60.0
					else:
						lh = dd
				runner.think = false
				runs += 1
				trips.append(t)
				last_hidden.append(lh)
		var parts: Array = []
		for b in 4:
			parts.append("%.0f-%.0f m: in sight %.2f of %.2f s (%s)" % [bands[b], bands[b + 1], seen[b] / runs, tot[b] / runs,
				_pct_f(seen[b], tot[b])])
		print("EXPOSURE %s runner (eye %.2f m) vs %s holder eyes (%.2f m over the slab), %d points x %d runs, per trip: %s · in sight within 60 m %.2f s · last hidden %s m from the centre · trip %s s" % [
			SPEC[team], runner._eye().y - runner.global_position.y, SPEC[1 - team], holder_eye, pts.size(), n, " · ".join(parts),
			(seen[0] + seen[1] + seen[2] + seen[3]) / runs, _mean_s(last_hidden.filter(func(x): return x >= 0.0)), _mean_s(trips)])

## (c) Holder standoff: a Corgi-side Corgi and a Cat-side Cat stand on opposite edges of the slab, 1 m inside (on
## the Corgis' side, -Z, and the Cats', +Z), both thinking and mortal, then the sides swapped. Facing each other, or
## facing away. Who wins, who sees the other first, who fires first.
func _standoff(game: Node, lab: Dictionary) -> void:
	var c0: Vector3 = game.slab.center
	var hz: float = game.slab.size.y * 0.5 - 1.0
	var south: Vector3 = game._ground_hit(c0 + Vector3(0, 0, -hz)).position
	var north: Vector3 = game._ground_hit(c0 + Vector3(0, 0, hz)).position
	var c: Node = lab["00"]
	var k: Node = lab["11"]
	print("STANDOFF spots: Corgi side (%.1f, %.1f) ground %.3f, Cat side (%.1f, %.1f) ground %.3f; the bots aim from Corgi %.3f, Cat %.3f m over the feet, at Corgi %.3f, Cat %.3f m" % [
		south.x, south.z, south.y, north.x, north.z, north.y, c._eye().y - c.global_position.y,
		k._eye().y - k.global_position.y, c._aim_point(c).y - c.global_position.y, k._aim_point(k).y - k.global_position.y])
	_park(game, lab, [c, k])
	for facing in ["each other", "away"]:
		for swap in [false, true]:
			var wins := [0, 0]
			var undecided := 0
			var sight := [[], []]
			var sight_first := [0, 0, 0]  # Corgi first, Cat first, same tick
			var fire_first := [0, 0, 0]
			var acc := [[0, 0, 0, 0.0], [0, 0, 0, 0.0]]  # per shooter: shots, hits, head hits, damage dealt
			var cons: Array = []
			var fired_at := [-1.0, -1.0]
			var tnow := [0.0]
			var to_kill := [[], []]  # per winner: seconds from its first shot to the kill
			var ready := [0, 0]  # frames a bot had its target in sight, past its reaction, out of its pause, rifle ready
			var gated := [0, 0]  # of those, frames its aim was off the target's chest by more than bot.gd FIRE_CONE
			var gap := [0.0, 0]  # flat distance between them, summed over fight frames, and the frame count
			for pair in [[c, 0], [k, 1]]:
				var sp: int = pair[1]
				var other: Node = k if pair[0] == c else c
				var f := func(res: Dictionary) -> void:
					acc[sp][0] += 1
					if fired_at[sp] < 0.0:
						fired_at[sp] = tnow[0]
					if res.get("target") == other:
						acc[sp][1] += 1
						acc[sp][3] += float(res.get("damage", 0.0))
						if res.get("head", false):
							acc[sp][2] += 1
				pair[0].rifle.fired.connect(f)
				cons.append([pair[0], f])
			for i in n:
				var pc: Vector3 = north if swap else south
				var pk: Vector3 = south if swap else north
				game.pets = [c, k]
				seed(seed0 + i)
				_lab_reseed(c, seed0 + i)
				_lab_reseed(k, seed0 + i)
				var yc: float = game._yaw_to(pc, pk) if facing == "each other" else game._yaw_to(pk, pc)
				var yk: float = game._yaw_to(pk, pc) if facing == "each other" else game._yaw_to(pc, pk)
				c.respawn(pc + Vector3(0, 0.05, 0), yc)
				k.respawn(pk + Vector3(0, 0.05, 0), yk)
				c.shield = 0.0
				k.shield = 0.0
				c.think = true
				k.think = true
				fired_at[0] = -1.0
				fired_at[1] = -1.0
				var saw := [-1.0, -1.0]
				var t := 0.0
				while t < 20.0 and c.alive and k.alive:
					_hold(game)
					for s in 2:  # the state each bot shoots from this frame (sampled before the bots run)
						var me: Node = c if s == 0 else k
						var other: Node = k if s == 0 else c
						if me.target == other and me.target_visible and me.seen >= me.react and me._pause <= 0.0 \
								and me.rifle.can_fire():
							ready[s] += 1
							if me.aim_dir.angle_to(me._aim_point(other) - me._eye()) > Bot.FIRE_CONE:
								gated[s] += 1
					if saw[0] >= 0.0 or saw[1] >= 0.0:
						gap[0] += Vector2(c.global_position.x - k.global_position.x, c.global_position.z - k.global_position.z).length()
						gap[1] += 1
					await physics_frame
					t += 1.0 / 60.0
					tnow[0] = t
					for s in 2:
						var me: Node = c if s == 0 else k
						if saw[s] < 0.0 and me.target_visible and me.target == (k if s == 0 else c):
							saw[s] = t
				for s in 2:
					if saw[s] >= 0.0:
						sight[s].append(saw[s])
				sight_first[_first_of(saw)] += 1
				fire_first[_first_of(fired_at)] += 1
				if c.alive == k.alive:
					undecided += 1
				else:
					var w := 0 if c.alive else 1
					wins[w] += 1
					if fired_at[w] >= 0.0:
						to_kill[w].append(t - fired_at[w])
				if events:
					print("  SO trial %d · winner %s at %.2f s · saw %.2f / %.2f · fired %.2f / %.2f · hp left %.0f / %.0f · dist %.2f m" % [
						i, "Corgi" if c.alive and not k.alive else ("Cat" if k.alive and not c.alive else "-"), t, saw[0], saw[1],
						fired_at[0], fired_at[1], c.hp, k.hp, Vector2(c.global_position.x - k.global_position.x,
						c.global_position.z - k.global_position.z).length()])
				c.think = false
				k.think = false
			for e in cons:
				e[0].rifle.fired.disconnect(e[1])
			print("STANDOFF facing %s, Corgi on the %s side · Corgi wins %d · Cat wins %d · undecided %d · first to see Corgi %d / Cat %d / same %d (mean %s / %s s) · first to fire Corgi %d / Cat %d / same %d · hit rate Corgi %s (%d), Cat %s (%d) · head hits Corgi %s of hits, Cat %s · damage per hit Corgi %.2f, Cat %.2f · winner's first shot to the kill Corgi %s s, Cat %s s" % [
				facing, "Cat" if swap else "Corgi", wins[0], wins[1], undecided, sight_first[0], sight_first[1],
				sight_first[2], _mean_s(sight[0]), _mean_s(sight[1]), fire_first[0], fire_first[1], fire_first[2],
				_pct1(acc[0][1], acc[0][0]), acc[0][0], _pct1(acc[1][1], acc[1][0]), acc[1][0], _pct1(acc[0][2], acc[0][1]),
				_pct1(acc[1][2], acc[1][1]), acc[0][3] / maxf(1.0, acc[0][1]), acc[1][3] / maxf(1.0, acc[1][1]),
				_mean_s2(to_kill[0]), _mean_s2(to_kill[1])])
			print("STANDOFF   aim gate: ready frames Corgi %d, Cat %d · aim off the chest by more than FIRE_CONE Corgi %s, Cat %s · mean gap while fighting %.2f m" % [
				ready[0], ready[1], _pct1(gated[0], ready[0]), _pct1(gated[1], ready[1]), gap[0] / maxf(1.0, gap[1])])

## 0 when [a, b]'s first value comes first (or only it happened), 1 for the second, 2 when both in the same tick or neither.
static func _first_of(v: Array) -> int:
	if v[0] < 0.0 and v[1] < 0.0:
		return 2
	if v[1] < 0.0 or (v[0] >= 0.0 and v[0] < v[1] - 1e-4):
		return 0
	if v[0] < 0.0 or v[1] < v[0] - 1e-4:
		return 1
	return 2

static func _mean_s2(a: Array) -> String:
	if a.is_empty():
		return "-"
	var s := 0.0
	for v in a:
		s += float(v)
	return "%.2f" % (s / a.size())

## (c2) A holder and an arriving attacker: one species stands in the slab's middle (thinking, holding), the other
## starts ARRIVE_D m out on its own team's way in (the line from the slab's centre to its team's first respawn
## point), facing the slab; both mortal. Then the species swap roles. Who wins, and the distance at the kill.
const ARRIVE_D := 16.0

func _arrival(game: Node, lab: Dictionary) -> void:
	var c0: Vector3 = game.slab.center
	var c: Node = lab["00"]
	var k: Node = lab["11"]
	_park(game, lab, [c, k])
	for holder_sp in 2:
		var h: Node = c if holder_sp == 0 else k
		var a: Node = k if holder_sp == 0 else c
		var home: Vector3 = game.respawn_slots[a.team][0]
		var dir := Vector3(home.x - c0.x, 0.0, home.z - c0.z).normalized()
		var g: Dictionary = game._ground_hit(c0 + dir * ARRIVE_D)
		var start: Vector3 = (g.position if not g.is_empty() else c0 + dir * ARRIVE_D) + Vector3(0, 0.05, 0)
		var mid: Vector3 = game._ground_hit(c0).position + Vector3(0, 0.05, 0)
		var wins := [0, 0]  # holder, attacker
		var undecided := 0
		var kill_d := [[], []]
		var on_slab_kill := 0
		for i in n:
			game.pets = [c, k]
			seed(seed0 + i)
			_lab_reseed(c, seed0 + i)
			_lab_reseed(k, seed0 + i)
			h.respawn(mid, game._yaw_to(mid, start) + PI * float(i % 2))  # half the trials facing the attacker
			a.respawn(start, game._yaw_to(start, c0))
			c.shield = 0.0
			k.shield = 0.0
			c.think = true
			k.think = true
			var t := 0.0
			while t < 25.0 and c.alive and k.alive:
				_hold(game)
				await physics_frame
				t += 1.0 / 60.0
			if c.alive == k.alive:
				undecided += 1
			else:
				var w := 0 if h.alive else 1
				wins[w] += 1
				kill_d[w].append(Vector2(c.global_position.x - k.global_position.x, c.global_position.z - k.global_position.z).length())
				if game.slab.contains(a.global_position):
					on_slab_kill += 1
			c.think = false
			k.think = false
		print("ARRIVAL %s holds, %s arrives from %.0f m · holder wins %d · attacker wins %d · undecided %d · gap at the kill: holder wins %s m, attacker wins %s m · the attacker on the slab at the end %d" % [
			SPEC[holder_sp], SPEC[1 - holder_sp], ARRIVE_D, wins[0], wins[1], undecided, _mean_s(kill_d[0]),
			_mean_s(kill_d[1]), on_slab_kill])

## (c3) A 2v2 brawl on the slab: two Corgi-side Corgis and two Cat-side Cats placed as in tests/test_bot_contest.gd
## (Corgis 2.5 m to the -Z side of the centre, Cats to the +Z side, 4 m apart sideways), all thinking and mortal, no
## respawns, until one side is down (25 s at most). The sides swap every other trial. Which species is left standing.
func _brawl(game: Node, lab: Dictionary) -> void:
	var c0: Vector3 = game.slab.center
	var extra := [_lab_pet(game, 0, 0), _lab_pet(game, 1, 1)]
	extra[0].name = "Lab00b"
	extra[1].name = "Lab11b"
	var corgis: Array = [lab["00"], extra[0]]
	var cats: Array = [lab["11"], extra[1]]
	_park(game, lab, corgis + cats)
	var wins := [0, 0]
	var left := [0, 0]
	var undecided := 0
	var first_down := [0, 0]
	for i in n:
		var flip := 1.0 if i % 2 == 0 else -1.0
		game.pets = corgis + cats
		seed(seed0 + i)
		for p in game.pets:
			_lab_reseed(p, seed0 + i)
		for j in 2:
			var pc: Vector3 = game._ground_hit(c0 + Vector3(-2.0 + 4.0 * j, 0.0, -2.5 * flip)).position + Vector3(0, 0.05, 0)
			var pk: Vector3 = game._ground_hit(c0 + Vector3(-2.0 + 4.0 * j, 0.0, 2.5 * flip)).position + Vector3(0, 0.05, 0)
			corgis[j].respawn(pc, game._yaw_to(pc, c0))
			cats[j].respawn(pk, game._yaw_to(pk, c0))
		for p in game.pets:
			p.shield = 0.0
			p.think = true
		var first := -1
		var t := 0.0
		while t < 25.0:
			_hold(game)
			await physics_frame
			t += 1.0 / 60.0
			var up := [corgis.filter(func(p): return p.alive).size(), cats.filter(func(p): return p.alive).size()]
			if first < 0 and (up[0] < 2 or up[1] < 2):
				first = 0 if up[0] < 2 else 1
			if up[0] == 0 or up[1] == 0:
				break
		var up2 := [corgis.filter(func(p): return p.alive).size(), cats.filter(func(p): return p.alive).size()]
		if first >= 0:
			first_down[first] += 1
		if (up2[0] == 0) == (up2[1] == 0):
			undecided += 1
		else:
			var w := 0 if up2[0] > 0 else 1
			wins[w] += 1
			left[w] += up2[w]
		for p in game.pets:
			p.think = false
	print("BRAWL 2v2 on the slab · Corgis win %d (with %.2f left) · Cats win %d (with %.2f left) · undecided %d · first pet down: a Corgi %d, a Cat %d" % [
		wins[0], float(left[0]) / maxf(1.0, wins[0]), wins[1], float(left[1]) / maxf(1.0, wins[1]), undecided, first_down[0],
		first_down[1]])

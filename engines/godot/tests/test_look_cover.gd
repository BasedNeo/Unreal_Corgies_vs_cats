extends RefCounted
## G-ATMOS (Wave 15): the cover read. At night, from the play camera, a player must tell at a glance which kit pieces
## stop bullets (cover) from the ones that do not (thin or overhead).
## 1. The cover table comes from the shared collision data (World.data.colliders, exported from src/shared/world/lot):
##    a piece is cover where its colliders stand on the ground and rise past a pet's centre of mass (BODY_H). Every
##    world collider stops the rifle's ray (layer 1), so "stops bullets" alone does not make cover: a 22 m-high lamp
##    head or a mast above a pet's head stops a ray but shields nobody.
## 2. Headless (CI, which renders nothing): the look's own table (Look.COVER) agrees with the colliders; every cover
##    piece's kit material carries the cover read and the non-cover parts do not; the read's rule is in
##    kit_wet.gdshader's source (SHADER_RULE: one gain per piece from its mean base-colour luminance held in
##    [cover_floor, cover_ceil], the texel guard [cover_lo, cover_cap], the saturation by cover_sat, the fill faded by
##    cover_pool inside a flood's cone, the sheen's fall-off by cover_sheen_power masked off flat up-facing faces at
##    0.85..0.97 on the world normal; the zone's height ly = VERTEX.y), and nothing else writes EMISSION (the lens's
##    `=` and the read's `+=`, the fragment's last statement); the band [0.22, 0.28], the guard [0.08, 0.5], the power 3
##    and the moon colour are pinned; Look.COVER_MEAN is recomputed from each GLB's base-colour image; each renderer's
##    values and per-piece scales hold through the look's own helpers called with every rendering method
##    (Compatibility takes its own scales, never Forward+'s), with the means, the moon and the Lot's floods on every
##    cover material; no cover piece's brightest texel, max(r, g, b), reaches the glow threshold (_glow_check); the
##    read's A/B toggle zeroes and restores every cover material's fill and sheen; the kit's draw shape (one MultiMesh
##    per piece plus KitShadow) and the look's own draw items are unchanged with the cover read on, so it cannot add
##    draws.
## 3. With a renderer: from the play camera (EYE_H over the ground, fov 72) at 10 / 30 / 60 m from cover pieces at both
##    bases and on two lanes, every cover piece's silhouette edge contrast is >= BAR_EDGE (CIE L*), every cover piece
##    is lighter than the non-cover mast pole at the same place by >= BAR_GAP L* at 10 and 30 m (cover is the light
##    value class, the thin mast a dark line; at 60 m the gap is printed as REPORTED), the read lifts a dark view's body to at most BODY_MAX L* and a flood-lit view's
##    by at most LIFT_MAX at 10 and 30 m and keeps its L* std (>= STD_KEEP x read off) at every distance, and the
##    frame's draw calls with the cover read stay within DRAW_GROWTH of without it (a render tolerance only: the lead's
##    bar is x1.000, gated exactly by the headless draw-item check, read on against off). `-- --cover-shots <dir>` also saves every view;
##    `-- --cover-quick` measures at 30 m only (a tuning loop; the bar needs all three distances).
##    All the views take 10+ min on a software Forward+, past run.gd's 600 s watchdog, so the rendered bar runs as one
##    run per place and distance (COVER_ONLY: places, pieces or "place/piece", comma-separated; COVER_D: distances),
##    each at most four views (a place's mast pole always comes with it); docs/qa/w15/COVER.md has the loop:
##      for d in 10 30 60; do for p in "corgi base" "cat base" "west lane" "east lane" "slab approach"; do
##        COVER_ONLY="$p" COVER_D=$d xvfb-run -a godot --path engines/godot [--rendering-method gl_compatibility
##          --rendering-driver opengl3] --script res://tests/run.gd -- --only look_cover || echo "FAIL $p $d"; done; done
## The bar: L* is perceptual lightness (0..100). ΔL* >= 15 between a silhouette's inner and outer edge is three-quarters
## of one step on a five-step value scale (20 L* per step), the scale value studies use to keep figure and ground in
## separate value groups; under ~10 L* a dark piece merges with a dark ground at a glance. BAR_GAP = 10 L* (half a
## step, about five just-noticeable differences of ~2 L*) keeps cover and the thin mast in different value bands.
const BAR_EDGE := 15.0
const BAR_GAP := 10.0
## The value gap is gated at the fight distances (10 and 30 m), as the lift rule is; farther (60 m) it is printed as
## REPORTED and only the edge gate holds (lead's ruling 2026-10-12: at 60 m Forward+'s volumetric sodium haze lights the
## mast pole itself, which the W17 AIR pass retunes).
const GAP_GATED_MAX := 30.0
const DRAW_GROWTH := 1.05
## The ceiling (W15 Q-check, shared with the web twin): each cover view is rendered with the read on and off. A dark view
## (body L* < LIT_OFF with the read off) may be lifted to at most BODY_MAX at 10 and 30 m; a view the floods already
## light (>= LIT_OFF) may be lifted by at most LIFT_MAX there. At every distance the read keeps the piece's own shading
## and texture: its body L* std stays >= STD_KEEP x the std with the read off (no flat cream block).
const BODY_MAX := 40.0
const LIT_OFF := 35.0
const LIFT_MAX := 5.0
const STD_KEEP := 0.85
const BODY_H := 0.6       # a pet's centre of mass (half the corgi's 1.2 m capsule)
const GROUND_EPS := 0.35  # a collider "stands on the ground" if its bottom is at most this far above it
const SHIELD_W := 1.0     # a collider shields a pet (0.72 m wide) if it is at least this wide
const EYE_H := 1.5        # the third-person camera over the pet's feet
const FOV := 72.0         # player.gd FOV
const DISTANCES := [10.0, 30.0, 60.0]
## collider type -> kit piece (the builders in src/shared/world/lot: props.ts bagWall, footing, container, floodTower;
## pipes.ts addPipe)
const OWNER := {
	"bags": "Kit_Lot_BagWall_01", "footing": "Kit_Lot_Footing_01",
	"pipe": "Kit_Lot_Pipe_01", "pipe_invert": "Kit_Lot_Pipe_01", "pipe_wedge": "Kit_Lot_Pipe_01",
	"container_floor": "Kit_Lot_Container20_01", "container_roof": "Kit_Lot_Container20_01",
	"container_wall": "Kit_Lot_Container20_01", "container_door": "Kit_Lot_Container20_01",
	"container_post": "Kit_Lot_Container20_01", "container_header": "Kit_Lot_Container20_01",
	"flood_base": "Kit_Lot_FloodMast_01", "flood_mast": "Kit_Lot_FloodMast_01",
	"flood_bar": "Kit_Lot_FloodLamp_01", "flood_head": "Kit_Lot_FloodLamp_01",
}
## Where a player meets the kit at night: [place, piece, instance, part, approach (x, z)]. part "cover" = the piece's
## cover zone (all of it, or the FloodMast's ballast), "pole" = the part above it (non-cover). The camera stands
## between the piece and the approach point, at 10 / 30 / 60 m.
const SAMPLES := [
	["corgi base", "Kit_Lot_Footing_01", 1, "cover", Vector2(-65, -114)],
	["corgi base", "Kit_Lot_BagWall_01", 3, "cover", Vector2(-40, -112)],
	["corgi base", "Kit_Lot_FloodMast_01", 0, "cover", Vector2(-60, -104)],
	["corgi base", "Kit_Lot_FloodMast_01", 0, "pole", Vector2(-60, -104)],
	["cat base", "Kit_Lot_FloodMast_01", 3, "cover", Vector2(65, 112)],
	["cat base", "Kit_Lot_FloodMast_01", 3, "pole", Vector2(65, 112)],
	["west lane", "Kit_Lot_Container20_01", 1, "cover", Vector2(-80, -70)],
	["west lane", "Kit_Lot_BagWall_01", 15, "cover", Vector2(-75, -75)],
	["east lane", "Kit_Lot_Pipe_01", 0, "cover", Vector2(40, 4)],
	["slab approach", "Kit_Lot_BagWall_01", 13, "cover", Vector2(0, 0)],
]
## The mask: unshaded, unfogged grey (0.6 x exposure stays under the glow threshold, so nothing blooms past the
## outline) against black; the tonemap desaturates colours, so the mask is told apart by brightness.
const MASK_ON := Color(0.6, 0.6, 0.6)
const MASK_SHADER := """shader_type spatial;
render_mode unshaded, fog_disabled, cull_back;
uniform vec3 col_a : source_color;
uniform vec3 col_b : source_color;
uniform float split = 1e6;
varying float ly;
void vertex() { ly = VERTEX.y; }
void fragment() { ALBEDO = ly < split ? col_a : col_b; }
"""
## The cover read's rule in kit_wet.gdshader, statement by statement (compared without comments or whitespace). CI
## renders nothing, so this is where a lost uniform, a hard-coded fall-off or a dropped or inverted up-face mask shows.
## tw-look's twin copies the same rule (tests/unit/kit-cover.test.ts).
const MOON_SRGB := Color(0.62, 0.72, 0.95)  # the sheen's colour, sRGB (look.gd COVER_SHEEN_COLOR, the web's moon)
const SHADER_RULE := [
	["the cover zone's height (mesh-local, from the foot), the world position and normal",
		"ly = VERTEX.y; wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);"],
	["the lens's own emission, before the cover read", "EMISSION = texture(emission_tex, UV).rgb * emission_color * emission_energy;"],
	["the albedo, left as it was (no dim)", "ALBEDO = wet_alb;"],
	["the cover zone", "float cover = step(ly, cover_top) * step(0.001, cover_top); if (cover > 0.0) {"],
	["the sheen: (1 - N.V)^cover_sheen_power, off flat up-facing faces (0.85..0.97 on the world normal)",
		"float graze = pow(1.0 - clamp(dot(normalize(NORMAL), VIEW), 0.0, 1.0), cover_sheen_power) * (1.0 - smoothstep(0.85, 0.97, wnrm.y));"],
	["the texture-keeping fill: one gain per piece, its mean held in [cover_floor, cover_ceil]",
		"vec3 held = wet_alb * (clamp(cover_mean, cover_floor, cover_ceil) / max(cover_mean, 1e-4));"],
	["the outlier guard: a texel's held luminance kept in [cover_lo, cover_cap]",
		"float hl = dot(held, vec3(0.2126, 0.7152, 0.0722)); held = mix(vec3(cover_lo), held * (clamp(hl, cover_lo, cover_cap) / max(hl, 1e-4)), step(1e-4, hl));"],
	["the fill's saturation by cover_sat", "held = max(mix(vec3(dot(held, vec3(0.2126, 0.7152, 0.0722))), held, cover_sat), vec3(0.0));"],
	["the flood pools: the strongest flood cone, 1 inside 16 degrees of its axis, 0 outside its 32-degree spot",
		"float pool = 0.0; for (int i = 0; i < cover_flood_count; i++) { pool = max(pool, smoothstep(0.848, 0.961, dot(normalize(wpos - cover_flood_pos[i]), cover_flood_aim[i]))); }"],
	["the emission: fill (faded by cover_pool in the pools) plus sheen, on the zone only",
		"EMISSION += held * cover_fill * (1.0 - cover_pool * pool) + cover_sheen_color * cover_sheen * graze; }"],
]

var _lin := PackedFloat32Array()


## {piece: {"stops": bool, "cover_top": metres over the ground (0: not cover), "top": highest collider top}}.
## Per placement, the piece's colliders that are at least SHIELD_W across (a pet is 0.72 m wide) are stacked up from
## the ground (each starting at most GROUND_EPS over the one below); the stack's top, if it reaches BODY_H, is the cover
## height. A piece's cover height is its lowest placement's.
static func cover_table(world: Node) -> Dictionary:
	var rows := {}  # piece -> [world AABB of each collider]
	for b in world.data.colliders.boxes:
		if OWNER.has(b[0]):
			var basis := Basis.from_euler(Vector3(b[8], b[7], b[9]), EULER_ORDER_YXZ)
			var h := Vector3(b[4], b[5], b[6])
			var ext := Vector3.ZERO
			for i in 3:
				ext[i] = absf(basis[0][i]) * h.x + absf(basis[1][i]) * h.y + absf(basis[2][i]) * h.z
			rows.get_or_add(OWNER[b[0]], []).append(AABB(Vector3(b[1], b[2], b[3]) - ext, ext * 2.0))
	for c in world.data.colliders.cylinders:
		if OWNER.has(c[0]):
			var ext := Vector3(c[4], c[5], c[4])
			rows.get_or_add(OWNER[c[0]], []).append(AABB(Vector3(c[1], c[2], c[3]) - ext, ext * 2.0))
	var out := {}
	for p in OWNER.values():
		if out.has(p):
			continue
		var e := {"stops": rows.has(p), "cover_top": 0.0, "top": 0.0}
		out[p] = e
		if not rows.has(p) or not world.kit_xforms.has(p):
			continue
		var lowest := INF
		for xf in world.kit_xforms[p]:
			# this placement's colliders: those whose footprint overlaps the placed mesh's footprint
			var foot: AABB = xf * (world.kit_nodes[p] as MultiMeshInstance3D).multimesh.mesh.get_aabb()
			var o: Vector3 = xf.origin
			var g: float = world.ground_height(o.x, o.z)
			var mine: Array = []
			for r: AABB in rows[p]:
				if r.position.x <= foot.end.x and r.end.x >= foot.position.x and r.position.z <= foot.end.z and r.end.z >= foot.position.z:
					mine.append(r)
					e.top = maxf(e.top, r.end.y - g)
			mine.sort_custom(func(u: AABB, v: AABB): return u.position.y < v.position.y)
			var stack := 0.0
			for r: AABB in mine:
				if maxf(r.size.x, r.size.z) >= SHIELD_W and r.position.y - g <= stack + GROUND_EPS:
					stack = maxf(stack, r.end.y - g)
			lowest = minf(lowest, stack)
		e.cover_top = lowest if lowest >= BODY_H and lowest < INF else 0.0
	return out


func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var rendering := DisplayServer.get_name() != "headless"
	var host := Node3D.new()
	var world: Node3D = load("res://world/world.gd").new()
	world.name = "World"
	host.add_child(world)
	var look: Node = load("res://look/look.gd").new()
	look.name = "Look"
	look.raining = false  # rain streaks are noise in a pixel metric
	host.add_child(look)
	var cam := Camera3D.new()
	cam.fov = FOV
	cam.far = 400.0
	host.add_child(cam)
	tree.root.add_child(host)
	var applied := [false]
	look.applied.connect(func(): applied[0] = true)
	for i in 1200:
		if applied[0]:
			break
		await tree.process_frame
	if not applied[0]:
		host.queue_free()
		return ["the look never applied (World.built not seen)"]
	cam.current = true

	# 1. the cover table, from the colliders, and the look's own
	var table := cover_table(world)
	var has_cover: bool = "COVER" in look
	for p in table:
		var t: Dictionary = table[p]
		print("  cover table: %-24s stops bullets %-5s cover up to %4.2f m (top %5.2f m)" % [p, t.stops, t.cover_top, t.top])
		if not has_cover:
			continue
		var want: float = look.COVER.get(p, -1.0)
		if want < 0.0:
			errs.append("Look.COVER has no entry for %s" % p)
		elif (t.cover_top > 0.0) != (want > 0.0):
			errs.append("%s: the colliders say cover up to %.2f m, Look.COVER says %.2f" % [p, t.cover_top, want])
		elif want > 0.0 and want < 1e5 and absf(want - t.cover_top) > 0.35:
			errs.append("%s: Look.COVER's cover zone ends at %.2f m, its colliders at %.2f m" % [p, want, t.cover_top])
		elif want >= 1e5 and t.top - t.cover_top > 0.5:
			errs.append("%s: Look.COVER marks the whole piece as cover, but its colliders shield a pet only up to %.2f m of %.2f m" % [
				p, t.cover_top, t.top])
	if not has_cover:
		errs.append("Look has no COVER table (no cover read)")

	# 2. headless-safe: the kit materials carry the cover read; the draw shape is unchanged
	var kit_root: Node = world.get_node("Kit")
	var kit_items := _draw_items(kit_root)
	var look_items := _draw_items(look)
	if has_cover:
		for p in world.kit_nodes:
			var mmi: MultiMeshInstance3D = world.kit_nodes[p]
			var m: Material = mmi.multimesh.mesh.surface_get_material(0)
			var top = m.get_shader_parameter("cover_top") if m is ShaderMaterial else null
			var want: float = look.COVER.get(p, 0.0)
			if want > 0.0 and (top == null or float(top) < want - 0.01):
				errs.append("%s is cover but its material has no cover read (cover_top %s)" % [p, top])
			elif want > 0.0 and (float(m.get_shader_parameter("cover_fill")) <= 0.0 or float(m.get_shader_parameter("cover_sheen")) <= 0.0):
				errs.append("%s is cover but its cover fill / sheen is off" % p)
			elif want <= 0.0 and top != null and float(top) > 0.0:
				errs.append("%s is not cover but its material wears the cover read" % p)
		# the value-gap gate itself (the rendered bar uses it): gated at 10 and 30 m, reported at 60 m
		for c in [[25.0, 20.0, 10.0, "FAIL"], [25.0, 20.0, 30.0, "FAIL"], [25.0, 20.0, 60.0, "REPORTED"], [31.0, 20.0, 30.0, "ok"]]:
			if _gap_verdict(c[0], c[1], c[2]) != c[3]:
				errs.append("the value-gap gate: a gap of %.0f at %d m gives %s, want %s (gated at 10 and 30 m, reported at 60 m)" % [
					c[0] - c[1], int(c[2]), _gap_verdict(c[0], c[1], c[2]), c[3]])
		# the rule in the shader's source, statement by statement
		var src := _code(look.KIT_SHADER.code)
		for rule in SHADER_RULE:
			if not _code(rule[1]) in src:
				errs.append("kit_wet.gdshader lost the cover rule's %s: want `%s`" % [rule[0], rule[1]])
		# ...and nothing else writes the emission: exactly the lens's `EMISSION =` and the cover's one `EMISSION +=`, and
		# the cover's is the fragment's last statement (a term added after the rule would pass the statement pins alone)
		if src.count("EMISSION") != 2:
			errs.append("kit_wet.gdshader writes EMISSION %d times; want 2 (the lens's `=`, the cover read's `+=`)" % src.count("EMISSION"))
		# the cover block is exactly the pinned statements, in order, contiguous, at the fragment's end: a statement
		# inserted between two pins (a gain on `held`, a zeroed `pool`) passes the pins one by one (item 11b follow-up)
		# ...and nothing outside the block feeds it: the rule's inputs are each written once (`wet_alb *= 3.0;` before the
		# block, or `ly -= 0.3;` after the vertex pin, passes every pin and the block check)
		for wv in ["wet_alb", "ly", "wpos", "wnrm"]:
			var nw := RegEx.create_from_string("(?<![A-Za-z0-9_])" + wv + "[-+*/]?=(?!=)").search_all(src).size() + RegEx.create_from_string("vec3" + wv + "=(?!=)").search_all(src).size()
			if nw != 1:
				errs.append("kit_wet.gdshader writes %s %d times; want 1" % [wv, nw])
		var blk := _code(SHADER_RULE[1][1])   # the block starts at the lens's `EMISSION =`
		for ri in range(3, SHADER_RULE.size()):
			blk += _code(SHADER_RULE[ri][1])
		if not src.ends_with(blk + "}"):
			errs.append("kit_wet.gdshader: the cover block is not exactly the pinned rule, contiguous, at the fragment's end")
		if not src.ends_with(_code(SHADER_RULE[SHADER_RULE.size() - 1][1] + " }")):
			errs.append("kit_wet.gdshader: the cover read's emission is not the fragment's last statement")
		# the cover read's shape, pinned (the web twin copies it): the band [0.22, 0.28] a piece's mean is held in, the
		# outlier guard [0.08, 0.5] and the sheen's falloff power 3, on every renderer
		for method in look.COVER_VALUES:
			var pv: Dictionary = look.cover_values(method)
			if not (is_equal_approx(float(pv.floor), 0.22) and is_equal_approx(float(pv.ceil), 0.28) and is_equal_approx(float(pv.lo), 0.08)
					and is_equal_approx(float(pv.cap), 0.5) and is_equal_approx(float(pv.power), 3.0)):
				errs.append("%s: the cover read's band / guard / falloff moved (floor %.2f, ceil %.2f, lo %.2f, cap %.2f, power %.1f; want 0.22, 0.28, 0.08, 0.5, 3)" % [
					method, pv.floor, pv.ceil, pv.lo, pv.cap, pv.power])
		if not look.COVER_SHEEN_COLOR.is_equal_approx(MOON_SRGB):
			errs.append("Look.COVER_SHEEN_COLOR %s moved off the moon %s (the web twin copies it)" % [look.COVER_SHEEN_COLOR, MOON_SRGB])
		# each piece's mean base-colour luminance, recomputed from its GLB (the web twin computes the same)
		errs.append_array(_check_means(world, look))
		# every renderer's values and per-piece scales, through the look's own helpers: the materials as built for this
		# renderer, then _cover_params() run for each rendering method in turn (CI's headless renderer is only one of
		# them), against Look.COVER_VALUES and Look.COVER_SCALE read here
		var built: String = look.rendering_method
		var methods := [built, "forward_plus", "mobile", "gl_compatibility"]
		for mi in methods.size():
			var method: String = methods[mi]
			var cv: Dictionary = look.COVER_VALUES["gl_compatibility" if method == "gl_compatibility" else "forward_plus"]
			look.rendering_method = method
			for p in world.kit_nodes:
				var pm: Material = (world.kit_nodes[p] as MultiMeshInstance3D).multimesh.mesh.surface_get_material(0)
				if float(look.COVER.get(p, 0.0)) <= 0.0 or not pm is ShaderMaterial:
					continue
				var sc := _want_scale(look, p, method)
				var got: Dictionary = look.cover_scale(p, method)
				for k in ["fill", "sheen", "sat", "pool"]:
					if not is_equal_approx(float(got.get(k, -1.0)), float(sc[k])):
						errs.append("%s on %s: cover_scale %s = %s, want %s (COVER_SCALE's %s row)" % [
							p, method, k, got.get(k), sc[k], "gl_compatibility" if method == "gl_compatibility" else "forward_plus"])
				if mi > 0:  # the first pass checks the materials as built; the others re-run _cover_params per method
					look._cover_params(pm)
				for k in [["cover_floor", "floor", 1.0], ["cover_ceil", "ceil", 1.0], ["cover_lo", "lo", 1.0], ["cover_cap", "cap", 1.0], ["cover_sheen_power", "power", 1.0],
						["cover_fill", "fill", sc.fill], ["cover_sheen", "sheen", sc.sheen], ["cover_sat", "sat", sc.sat], ["cover_pool", "pool", sc.pool]]:
					var want_v := float(cv[k[1]]) * float(k[2])
					if not is_equal_approx(float(pm.get_shader_parameter(k[0])), want_v):
						errs.append("%s on %s: material %s = %s, want %s" % [p, method, k[0], pm.get_shader_parameter(k[0]), want_v])
				var moon_sent = pm.get_shader_parameter("cover_sheen_color")
				if moon_sent is Vector3:
					moon_sent = Color(moon_sent.x, moon_sent.y, moon_sent.z)
				if not (moon_sent is Color and (moon_sent as Color).is_equal_approx(MOON_SRGB)):
					errs.append("%s on %s: material cover_sheen_color = %s, want the moon %s" % [p, method, moon_sent, MOON_SRGB])
				if not is_equal_approx(float(pm.get_shader_parameter("cover_mean")), float(look.COVER_MEAN[p])):
					errs.append("%s: material cover_mean = %s, want COVER_MEAN's %s" % [p, pm.get_shader_parameter("cover_mean"), look.COVER_MEAN[p]])
				var fl: Array = world.floodlights()
				var fpos = pm.get_shader_parameter("cover_flood_pos")
				var faim = pm.get_shader_parameter("cover_flood_aim")
				if int(pm.get_shader_parameter("cover_flood_count")) != fl.size() or fpos == null or faim == null or fpos.size() < fl.size():
					errs.append("%s: the pool term has %s floods, the Lot %d" % [p, pm.get_shader_parameter("cover_flood_count"), fl.size()])
				else:
					for i in fl.size():
						var want_aim: Vector3 = (fl[i].target - fl[i].pos).normalized()
						if not (fpos[i] as Vector3).is_equal_approx(fl[i].pos) or not (faim[i] as Vector3).is_equal_approx(want_aim):
							errs.append("%s: pool flood %d is %s -> %s, the Lot's %s -> %s" % [p, i, fpos[i], faim[i], fl[i].pos, want_aim])
		look.rendering_method = built
		look.set_cover_read(true)  # back to this renderer's values
		# the look lock: the cover read's brightest emission, exposed, stays under the glow threshold on every renderer
		# (max(r, g, b), as Godot's glow keys it; see _glow_check)
		errs.append_array(_glow_check(world, look))
		look.set_cover_read(false)
		await tree.process_frame
		if _draw_items(kit_root) != kit_items or _draw_items(look) != look_items:
			errs.append("the cover read changes the draw items (kit %d -> %d, look %d -> %d)" % [
				_draw_items(kit_root), kit_items, _draw_items(look), look_items])
		# the A/B toggle is real (the rendered bar's "read off" frames depend on it): off zeroes every cover material's fill
		# and sheen, on restores this renderer's values
		var cvb: Dictionary = look.COVER_VALUES["gl_compatibility" if built == "gl_compatibility" else "forward_plus"]
		for p in world.kit_nodes:
			var tm: Material = (world.kit_nodes[p] as MultiMeshInstance3D).multimesh.mesh.surface_get_material(0)
			if float(look.COVER.get(p, 0.0)) > 0.0 and tm is ShaderMaterial:
				if float(tm.get_shader_parameter("cover_fill")) != 0.0 or float(tm.get_shader_parameter("cover_sheen")) != 0.0:
					errs.append("set_cover_read(false) leaves %s's read on (cover_fill %s, cover_sheen %s)" % [
						p, tm.get_shader_parameter("cover_fill"), tm.get_shader_parameter("cover_sheen")])
		look.set_cover_read(true)
		await tree.process_frame
		for p in world.kit_nodes:
			var tm: Material = (world.kit_nodes[p] as MultiMeshInstance3D).multimesh.mesh.surface_get_material(0)
			if float(look.COVER.get(p, 0.0)) > 0.0 and tm is ShaderMaterial:
				var tsc := _want_scale(look, p, built)
				if not is_equal_approx(float(tm.get_shader_parameter("cover_fill")), float(cvb.fill) * float(tsc.fill)) \
						or not is_equal_approx(float(tm.get_shader_parameter("cover_sheen")), float(cvb.sheen) * float(tsc.sheen)):
					errs.append("set_cover_read(true) does not restore %s's read (cover_fill %s, cover_sheen %s)" % [
						p, tm.get_shader_parameter("cover_fill"), tm.get_shader_parameter("cover_sheen")])
	if world.kit_nodes.size() + 1 != kit_items:
		errs.append("kit draw shape: %d items for %d pieces (want one MultiMesh per piece plus KitShadow)" % [
			kit_items, world.kit_nodes.size()])

	# 3. with a renderer: the pixel metric and the draw calls
	if rendering:
		errs.append_array(await _measure(tree, world, look, cam, has_cover))
	else:
		print("  (headless: the pixel metric needs a renderer; run under xvfb to measure it)")
	host.queue_free()
	await tree.process_frame
	return errs


## Look.COVER_MEAN against each kit piece's GLB: the mean over every texel of its base-colour image (the material's
## baseColorTexture, an embedded PNG; alpha ignored) of the Rec. 709 luminance of the sRGB-decoded channels, times the
## baseColorFactor's luminance. Read from the file itself (GLB chunks), so the web twin can compute the same.
func _check_means(world: Node, look: Node) -> Array:
	var errs: Array = []
	var lin := PackedFloat32Array()
	lin.resize(256)
	for i in 256:
		var c := i / 255.0
		lin[i] = c / 12.92 if c <= 0.04045 else pow((c + 0.055) / 1.055, 2.4)
	for k in world.data.kit:
		var piece: String = k.name
		if not look.COVER_MEAN.has(piece):
			errs.append("Look.COVER_MEAN has no entry for %s" % piece)
			continue
		var path := ProjectSettings.globalize_path("res://").path_join("../..").path_join(k.glb).simplify_path()
		var b := FileAccess.get_file_as_bytes(path)
		if b.size() < 28:
			errs.append("%s: no GLB at %s" % [piece, path])
			continue
		var jl := b.decode_u32(12)
		var j: Dictionary = JSON.parse_string(b.slice(20, 20 + jl).get_string_from_utf8())
		var bin := 28 + jl
		var pbr: Dictionary = j.materials[0].get("pbrMetallicRoughness", {})
		var f: Array = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
		var img := _glb_image(b, j, bin, int(pbr.baseColorTexture.index))
		if img == null:
			errs.append("%s: its base-colour image does not decode" % piece)
			continue
		var d := img.get_data()
		var s := 0.0
		for i in range(0, d.size(), 4):
			s += 0.2126 * lin[d[i]] + 0.7152 * lin[d[i + 1]] + 0.0722 * lin[d[i + 2]]
		var mean := s / (d.size() / 4) * (0.2126 * float(f[0]) + 0.7152 * float(f[1]) + 0.0722 * float(f[2]))
		if absf(mean - float(look.COVER_MEAN[piece])) > 0.0005:
			errs.append("%s: Look.COVER_MEAN %.4f, its GLB's base colour averages %.4f" % [piece, look.COVER_MEAN[piece], mean])
	return errs


## A GLB's embedded image (by texture index) as RGBA8, or null.
static func _glb_image(b: PackedByteArray, j: Dictionary, bin: int, tex: int) -> Image:
	var img_def: Dictionary = j.images[int(j.textures[tex].source)]
	var bv: Dictionary = j.bufferViews[int(img_def.bufferView)]
	var off := bin + int(bv.get("byteOffset", 0))
	var bytes := b.slice(off, off + int(bv.byteLength))
	var img := Image.new()
	var ok := img.load_png_from_buffer(bytes) if str(img_def.get("mimeType", "image/png")) == "image/png" else img.load_jpg_from_buffer(bytes)
	if ok != OK:
		return null
	img.convert(Image.FORMAT_RGBA8)
	return img


## The look lock on max(r, g, b): Godot 4.7.2's glow keys on a pixel's brightest channel, not on its luminance. For
## every cover piece and renderer, the cover read's own emission at its brightest texel, x exposure, stays under the
## glow threshold. Conservative, texel by texel through the shader's rule: every texel of the piece's base colour with
## its ORM metal (the porous darkening) and every placement's paint tint, the brightest wet factor (wet 0.75:
## mix(1, WET_DARKEN, 0.75)), no pool fade, and a full sheen (graze 1) on top of the fill.
func _glow_check(world: Node, look: Node) -> Array:
	var errs: Array = []
	var lin := PackedFloat32Array()
	lin.resize(256)
	for i in 256:
		var c := i / 255.0
		lin[i] = c / 12.92 if c <= 0.04045 else pow((c + 0.055) / 1.055, 2.4)
	var moon: Color = look.COVER_SHEEN_COLOR.srgb_to_linear()
	var wf := lerpf(1.0, float(look.WET_DARKEN), 0.75)
	var exposure: float = look.environment.tonemap_exposure
	var thr: float = look.environment.glow_hdr_threshold
	var methods := ["forward_plus", "gl_compatibility"]
	var v0: Dictionary = look.COVER_VALUES.forward_plus
	for k in world.data.kit:
		var piece: String = k.name
		if float(look.COVER.get(piece, 0.0)) <= 0.0:
			continue
		var path := ProjectSettings.globalize_path("res://").path_join("../..").path_join(k.glb).simplify_path()
		var b := FileAccess.get_file_as_bytes(path)
		var jl := b.decode_u32(12)
		var j: Dictionary = JSON.parse_string(b.slice(20, 20 + jl).get_string_from_utf8())
		var pbr: Dictionary = j.materials[0].get("pbrMetallicRoughness", {})
		var f: Array = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
		var base := _glb_image(b, j, 28 + jl, int(pbr.baseColorTexture.index))
		var orm: Image = _glb_image(b, j, 28 + jl, int(pbr.metallicRoughnessTexture.index)) if pbr.has("metallicRoughnessTexture") else null
		if base == null:
			errs.append("%s: its base-colour image does not decode" % piece)
			continue
		if orm != null and orm.get_size() != base.get_size():
			orm.resize(base.get_width(), base.get_height(), Image.INTERPOLATE_NEAREST)
		var tints: Array = [[1.0, 1.0, 1.0]]
		if bool(k.get("paintTint", false)):
			tints = []
			for r in k.placements:
				var t := [float(r[6]), float(r[7]), float(r[8])]
				if not t in tints:
					tints.append(t)
		var m := float(look.COVER_MEAN[piece])
		var gain := clampf(m, float(v0.floor), float(v0.ceil)) / maxf(m, 1e-4) * wf
		var lo := float(v0.lo)
		var cap := float(v0.cap)
		var fill := PackedFloat32Array()
		var sheen := PackedFloat32Array()
		var sat := PackedFloat32Array()
		for method in methods:
			var v: Dictionary = look.COVER_VALUES[method]
			var sc := _want_scale(look, piece, method)
			fill.append(float(v.fill) * float(sc.fill))
			sheen.append(float(v.sheen) * float(sc.sheen))
			sat.append(float(v.sat) * float(sc.sat))
		var peak := PackedFloat32Array([0.0, 0.0])
		var d := base.get_data()
		var od := orm.get_data() if orm != null else PackedByteArray()
		for i in range(0, d.size(), 4):
			var mask: float = clampf((d[i + 3] - 1.0) / 254.0, 0.0, 1.0)
			var pf: float = 1.0 - 0.4 * (1.0 - (od[i + 2] / 255.0 if od.size() > 0 else 0.0))
			for t in tints:
				var r: float = lin[d[i]] * float(f[0]) * (1.0 - mask + mask * float(t[0])) * gain * pf
				var g: float = lin[d[i + 1]] * float(f[1]) * (1.0 - mask + mask * float(t[1])) * gain * pf
				var bl: float = lin[d[i + 2]] * float(f[2]) * (1.0 - mask + mask * float(t[2])) * gain * pf
				var hl: float = 0.2126 * r + 0.7152 * g + 0.0722 * bl
				var l2 := lo
				if hl >= 1e-4:
					l2 = clampf(hl, lo, cap)
					var s: float = l2 / hl
					r *= s
					g *= s
					bl *= s
				else:
					r = lo
					g = lo
					bl = lo
				for mi in methods.size():
					var e: float = maxf(maxf(l2 + sat[mi] * (r - l2), 0.0) * fill[mi] + moon.r * sheen[mi],
							maxf(maxf(l2 + sat[mi] * (g - l2), 0.0) * fill[mi] + moon.g * sheen[mi],
							maxf(l2 + sat[mi] * (bl - l2), 0.0) * fill[mi] + moon.b * sheen[mi]))
					if e > peak[mi]:
						peak[mi] = e
		for mi in methods.size():
			print("  cover glow: %-24s %-16s peak max(r, g, b) %.3f (exposed) against the threshold %.2f" % [
				piece, methods[mi], peak[mi] * exposure, thr])
			if peak[mi] * exposure >= thr:
				errs.append("%s on %s: the cover read's brightest texel, max(r, g, b) %.3f (exposed), reaches the glow threshold %.2f" % [
					piece, methods[mi], peak[mi] * exposure, thr])
	return errs


## The value gap's verdict at a distance: "ok", "FAIL" (gated, under BAR_GAP) or "REPORTED" (under BAR_GAP past the
## fight distances, not gated).
static func _gap_verdict(worst: float, pole: float, d: float) -> String:
	if worst - pole >= BAR_GAP:
		return "ok"
	return "FAIL" if d <= GAP_GATED_MAX else "REPORTED"


## COVER_ONLY's match: a place by its name, a piece by a part of its name, or "place/piece".
static func _picks(only: String, s: Array) -> bool:
	if only == "":
		return true
	for o in only.split(","):
		if o == s[0] or (not "/" in o and o in s[1]) or ("/" in o and o.get_slice("/", 0) == s[0] and o.get_slice("/", 1) in s[1]):
			return true
	return false


## Shader source without comments or whitespace, so the rule compares by its tokens.
static func _code(src: String) -> String:
	src = RegEx.create_from_string("/\\*[\\s\\S]*?\\*/").sub(src, "", true)
	src = RegEx.create_from_string("//[^\\n]*").sub(src, "", true)
	return RegEx.create_from_string("\\s+").sub(src, "", true)


## The per-piece scales a renderer must take: Compatibility its own row of Look.COVER_SCALE, every other method
## (Forward+, Mobile) the Forward+ row. Read here from the table, not through Look.cover_scale(), so a gate that hands
## one renderer the other's scales fails.
static func _want_scale(look: Node, piece: String, method: String) -> Dictionary:
	var row: Dictionary = look.COVER_SCALE["gl_compatibility" if method == "gl_compatibility" else "forward_plus"]
	return row.get(piece, {"fill": 1.0, "sheen": 1.0, "sat": 1.0, "pool": 1.0})


## Geometry items that draw: visible GeometryInstance3D surfaces under `n` (MultiMeshes count once).
func _draw_items(n: Node) -> int:
	var c := 0
	for g in n.find_children("*", "GeometryInstance3D", true, false):
		if g.visible and g.is_visible_in_tree():
			c += 1
	return c


func _measure(tree: SceneTree, world: Node, look: Node, cam: Camera3D, has_cover: bool) -> Array:
	var errs: Array = []
	_lin.resize(256)
	for i in 256:
		var c := i / 255.0
		_lin[i] = c / 12.92 if c <= 0.04045 else pow((c + 0.055) / 1.055, 2.4)
	var shots := ""
	var ua := OS.get_cmdline_user_args()
	var si := ua.find("--cover-shots")
	if si >= 0 and si + 1 < ua.size():
		shots = ua[si + 1]
		DirAccess.make_dir_recursive_absolute(shots)
	var dists: Array = [30.0] if ua.has("--cover-quick") else DISTANCES  # a lane's own tuning loop
	if OS.get_environment("COVER_D") != "":  # the rendered bar's groups: one distance per run (see the header)
		dists = Array(OS.get_environment("COVER_D").split(",")).map(func(x): return float(x))
	var settle := 6 if RenderingServer.get_current_rendering_method() == "forward_plus" else 3
	var mask_mat := ShaderMaterial.new()
	mask_mat.shader = Shader.new()
	mask_mat.shader.code = MASK_SHADER
	var results := {}  # "place|d" -> {cover: [E...], pole: [E...]}
	var table := cover_table(world)
	# COVER_ONLY: only the samples at these places or of these pieces (comma-separated; a place by its name, a piece by a
	# part of its name, or "place/piece"). The mast pole of a place is always measured with its cover samples, so every
	# split run still checks the value gap. The rendered bar runs in such groups, each inside run.gd's watchdog (see the
	# header).
	var only := OS.get_environment("COVER_ONLY")
	var places := SAMPLES.filter(func(s): return s[3] == "cover" and _picks(only, s)).map(func(s): return s[0])
	var picked := SAMPLES.filter(func(s): return _picks(only, s) or (s[3] == "pole" and s[0] in places))
	if picked.is_empty():
		return ["COVER_ONLY=%s matches no sample (places: corgi base, cat base, west lane, east lane, slab approach)" % only]
	var measured := 0
	var no_view := 0
	for s in picked:
		var place: String = s[0]
		var piece: String = s[1]
		var idx: int = s[2]
		var part: String = s[3]
		var toward: Vector2 = s[4]
		if not world.kit_nodes.has(piece) or idx >= world.kit_xforms[piece].size():
			errs.append("sample %s %s[%d] does not exist" % [place, piece, idx])
			continue
		var mmi: MultiMeshInstance3D = world.kit_nodes[piece]
		var xf: Transform3D = world.kit_xforms[piece][idx]
		var la: AABB = mmi.multimesh.mesh.get_aabb()
		# the cover zone in the mesh's own height: the whole piece, or the FloodMast's ballast under its non-cover mast.
		# It is cut where the material cuts it (Look.COVER, mesh-local), so the ballast's own lit cap is not measured as
		# its background; a look without COVER (HEAD, before) is cut at the colliders' top.
		var t: Dictionary = table[piece]
		var split: float = 1e6
		if t.top > t.cover_top + 1.0:
			split = t.cover_top + world.ground_height(xf.origin.x, xf.origin.z) - xf.origin.y
			if has_cover and float(look.COVER.get(piece, 0.0)) < 1e5:
				split = float(look.COVER[piece])
		if part == "pole":
			la = AABB(Vector3(la.position.x, split, la.position.z), Vector3(la.size.x, la.end.y - split, la.size.z))
		elif split < la.end.y:
			la.size.y = split - la.position.y
		var box := xf * la
		for d in dists:
			var view := await _place_camera(tree, world, cam, box, toward, d, part == "pole")
			if view.is_empty():
				print("  COVER %-10s %-22s %-5s d=%2d  no clear view (skipped)" % [place, piece, part, d])
				no_view += 1 if part == "cover" else 0
				continue
			# normal frame
			mmi.material_override = null
			var img := await _frame(tree, settle)
			var dc: int = RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)
			# two mask frames: part A (under split) grey then black; part B the other way round
			mmi.material_override = mask_mat
			mask_mat.set_shader_parameter("split", split)
			mask_mat.set_shader_parameter("col_a", MASK_ON)
			mask_mat.set_shader_parameter("col_b", Color.BLACK)
			var m1 := await _frame(tree, 1)
			mask_mat.set_shader_parameter("col_a", Color.BLACK)
			mask_mat.set_shader_parameter("col_b", MASK_ON)
			var m2 := await _frame(tree, 1)
			# ...and the same pair with the piece drawn alone (its whole outline)
			var layers := mmi.layers
			mmi.layers = layers | (1 << 19)
			cam.cull_mask = 1 << 19
			var s2 := await _frame(tree, 1)
			mask_mat.set_shader_parameter("col_a", MASK_ON)
			mask_mat.set_shader_parameter("col_b", Color.BLACK)
			var s1 := await _frame(tree, 1)
			cam.cull_mask = 0xFFFFF
			mmi.layers = layers
			mmi.material_override = null
			var dbg: Image = img.duplicate() if shots != "" else null
			var rect := _rect(cam, box, img.get_size())
			var full := _mask(s1, s2, rect, part == "pole")
			var vis := _mask(m1, m2, rect, part == "pole")
			var vw := img.get_width()
			for y in range(rect.position.y, rect.end.y):
				for x in range(rect.position.x, rect.end.x):
					vis[y * vw + x] &= full[y * vw + x]  # not its reflection in a puddle (SSR mirrors the mask colours)
			var r := _edge_read(img, vis, full, rect, dbg)
			var body := _body(img, vis, rect)
			r.body = body.mean
			var key := "%s|%d" % [place, int(d)]
			if not results.has(key):
				results[key] = {"cover": [], "pole": []}
			var tag := "%s %s[%d] %s d=%d" % [place, piece.trim_prefix("Kit_Lot_").trim_suffix("_01"), idx, part, int(d)]
			if r.px < 20 or r.pairs < 10:
				print("  COVER %-44s too few pixels (%d px, %d edge pairs): skipped" % [tag, r.px, r.pairs])
				continue
			results[key][part].append(r)
			measured += 1 if part == "cover" else 0
			print("  COVER %-44s edge dL* %5.1f (median %5.1f)  edge in %5.1f out %5.1f  body L* %5.1f std %4.1f C* %4.1f  %6d px  draws %d" % [
				tag, r.edge, r.median, r.inner, r.outer, body.mean, body.std, body.chroma, r.px, dc])
			# the ceiling and the no-flattening rule, against the same view with the read off
			if has_cover and part == "cover":
				look.set_cover_read(false)
				var off_img := await _frame(tree, settle)
				var off := _body(off_img, vis, rect)
				look.set_cover_read(true)
				await _frame(tree, 2)
				var lit: bool = off.mean >= LIT_OFF
				print("  COVER %-44s read off: body L* %5.1f std %4.1f C* %4.1f  (the read adds %+5.1f L*, std x%.2f; %s view)" % [
					tag, off.mean, off.std, off.chroma, body.mean - off.mean, body.std / maxf(off.std, 0.01), "lit" if lit else "dark"])
				if d <= 30.0 and not lit and body.mean > BODY_MAX:
					errs.append("ceiling: %s body L* %.1f > %.1f on a dark view (the read bleaches it)" % [tag, body.mean, BODY_MAX])
				if d <= 30.0 and lit and body.mean - off.mean > LIFT_MAX:
					errs.append("ceiling: %s lifts a flood-lit view by %.1f L* > %.1f (off %.1f, on %.1f)" % [
						tag, body.mean - off.mean, LIFT_MAX, off.mean, body.mean])
				if body.std < STD_KEEP * off.std:
					errs.append("flattening: %s body L* std %.1f < %.2f x %.1f with the read off" % [tag, body.std, STD_KEEP, off.std])
			if shots != "":
				var stem := "%s_%s_%d_%s_%dm" % [place.replace(" ", "-"), piece.trim_prefix("Kit_Lot_").trim_suffix("_01"), idx, part, int(d)]
				img.save_png(shots.path_join(stem + ".png"))
				dbg.save_png(shots.path_join(stem + "_edges.png"))
				if OS.get_environment("COVER_DEBUG") != "":
					m1.save_png(shots.path_join(stem + "_mask.png"))
					s1.save_png(shots.path_join(stem + "_alone.png"))
					if dbg.has_meta("masks"):
						(dbg.get_meta("masks") as Image).save_png(shots.path_join(stem + "_masks.png"))
			if part == "cover" and r.edge < BAR_EDGE:
				errs.append("cover read: %s edge dL* %.1f < %.1f" % [tag, r.edge, BAR_EDGE])
	if measured == 0 and no_view == 0:
		errs.append("no cover view was measured (COVER_ONLY=%s)" % only)
	# cover vs the non-cover mast pole at the same place and distance: the cover pieces are the lighter value class
	for key in results:
		var cv: Array = results[key].cover
		var pl: Array = results[key].pole
		if cv.is_empty() or pl.is_empty():
			continue
		var worst := INF
		for r in cv:
			worst = minf(worst, r.body)
		var pole := -INF
		for r in pl:
			pole = maxf(pole, r.body)
		var verdict := _gap_verdict(worst, pole, float(key.get_slice("|", 1)))
		print("  COVER value %-14s darkest cover L* %5.1f  mast pole L* %5.1f  gap %5.1f%s" % [key, worst, pole, worst - pole,
			"  REPORTED (gated at <= %d m only)" % int(GAP_GATED_MAX) if verdict == "REPORTED" else ""])
		if verdict == "FAIL":
			errs.append("cover vs non-cover at %s: darkest cover L* %.1f, mast pole L* %.1f (gap < %.1f)" % [key, worst, pole, BAR_GAP])
	# draw calls with and without the cover read, at one view per place (30 m: in the runs that measure 30 m)
	if has_cover and dists.has(30.0):
		var on := 0
		var off := 0
		for s in picked:
			if s[3] != "cover":
				continue
			var xf: Transform3D = world.kit_xforms[s[1]][s[2]]
			var box: AABB = xf * (world.kit_nodes[s[1]] as MultiMeshInstance3D).multimesh.mesh.get_aabb()
			var view := await _place_camera(tree, world, cam, box, s[4], 30.0, false)
			if view.is_empty():
				continue
			look.set_cover_read(true)
			await _frame(tree, settle)
			on += RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)
			look.set_cover_read(false)
			await _frame(tree, settle)
			off += RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)
		look.set_cover_read(true)
		print("  COVER draws at 30 m, summed over the cover samples: %d with the cover read, %d without (x%.3f)" % [
			on, off, float(on) / maxf(1.0, float(off))])
		if off > 0 and float(on) > float(off) * DRAW_GROWTH:
			errs.append("the cover read grows the draw calls %d -> %d (> +5 %%)" % [off, on])
	return errs


## Puts the camera EYE_H over the ground, `d` metres from the box towards `toward`, looking at it, with a clear line of
## sight to the box (turns about the box up to +-90 degrees to find one). {} if no clear view.
func _place_camera(tree: SceneTree, world: Node, cam: Camera3D, box: AABB, toward: Vector2, d: float, pole: bool) -> Dictionary:
	var c := box.get_center()
	var base := Vector2(toward.x - c.x, toward.y - c.z).normalized()
	for turn in [0.0, 20.0, -20.0, 40.0, -40.0, 60.0, -60.0, 80.0, -80.0]:
		var dir := base.rotated(deg_to_rad(turn))
		var px: float = c.x + dir.x * d
		var pz: float = c.z + dir.y * d
		var eye := Vector3(px, world.ground_height(px, pz) + EYE_H, pz)
		# aim: a low piece at its middle; a tall one level with the eye (where a player looks); the pole a metre over
		# the ballast
		if box.grow(0.5).has_point(eye):
			continue  # inside the piece (a container is walk-through): no silhouette to read
		var aim := Vector3(c.x, clampf(eye.y, box.position.y + 0.3, box.end.y - 0.2), c.z)
		if box.size.y < 3.0:
			aim.y = c.y
		if pole:
			aim.y = maxf(box.position.y + 1.0, eye.y)
		await tree.physics_frame
		var space: PhysicsDirectSpaceState3D = world.get_world_3d().direct_space_state
		var pq := PhysicsPointQueryParameters3D.new()
		pq.position = eye
		if not space.intersect_point(pq, 1).is_empty():
			continue
		var q := PhysicsRayQueryParameters3D.create(eye, aim, 1)
		var hit := space.intersect_ray(q)
		if not hit.is_empty() and not box.grow(0.4).has_point(hit.position):
			continue
		cam.look_at_from_position(eye, aim, Vector3.UP)
		return {"eye": eye, "aim": aim}
	return {}


func _frame(tree: SceneTree, n: int) -> Image:
	for i in n:
		await RenderingServer.frame_post_draw
	var img := tree.root.get_texture().get_image()
	img.convert(Image.FORMAT_RGB8)
	return img


func _rect(cam: Camera3D, box: AABB, size: Vector2i) -> Rect2i:
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for i in 8:
		var p := box.get_endpoint(i)
		if cam.is_position_behind(p):
			return Rect2i(Vector2i.ZERO, size)
		var s := cam.unproject_position(p)
		lo = lo.min(s)
		hi = hi.max(s)
	var r := Rect2i(Vector2i(floori(lo.x) - 10, floori(lo.y) - 10), Vector2i(ceili(hi.x - lo.x) + 21, ceili(hi.y - lo.y) + 21))
	return r.intersection(Rect2i(Vector2i.ZERO, size))


## Mean and standard deviation of L*, and mean C* (CIELAB, D65), over the visible part's pixels (every 2nd px).
func _body(img: Image, vis: PackedByteArray, r: Rect2i) -> Dictionary:
	var w := img.get_width()
	var d := img.get_data()
	var n := 0
	var sl := 0.0
	var sl2 := 0.0
	var sc := 0.0
	for y in range(r.position.y, r.end.y, 2):
		for x in range(r.position.x, r.end.x, 2):
			if vis[y * w + x] == 0:
				continue
			var i := (y * w + x) * 3
			var cr: float = _lin[d[i]]
			var cg: float = _lin[d[i + 1]]
			var cb: float = _lin[d[i + 2]]
			var fx := _lab_f((0.4124 * cr + 0.3576 * cg + 0.1805 * cb) / 0.95047)
			var fy := _lab_f(0.2126 * cr + 0.7152 * cg + 0.0722 * cb)
			var fz := _lab_f((0.0193 * cr + 0.1192 * cg + 0.9505 * cb) / 1.08883)
			var l := 116.0 * fy - 16.0
			sl += l
			sl2 += l * l
			sc += Vector2(500.0 * (fx - fy), 200.0 * (fy - fz)).length()
			n += 1
	if n == 0:
		return {"mean": 0.0, "std": 0.0, "chroma": 0.0}
	var m := sl / n
	return {"mean": m, "std": sqrt(maxf(0.0, sl2 / n - m * m)), "chroma": sc / n}


func _lab_f(t: float) -> float:
	return pow(t, 1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0


func _lstar(d: PackedByteArray, i: int) -> float:
	var y: float = 0.2126 * _lin[d[i]] + 0.7152 * _lin[d[i + 1]] + 0.0722 * _lin[d[i + 2]]
	return 116.0 * pow(y, 1.0 / 3.0) - 16.0 if y > 0.008856 else 903.3 * y


## The part's pixels in a pair of mask frames (it drawn grey then black, or the other way round for part B), with
## seams of 1-3 px between its own faces closed (MSAA blends such a crack with what lies behind).
func _mask(m1: Image, m2: Image, r: Rect2i, part_b: bool) -> PackedByteArray:
	var w := m1.get_width()
	var a := m1.get_data()
	var b := m2.get_data()
	var inm := PackedByteArray()
	inm.resize(w * m1.get_height())
	for y in range(r.position.y, r.end.y):
		for x in range(r.position.x, r.end.x):
			var i := (y * w + x) * 3
			var dd: int = a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]
			if (dd > 200 and not part_b) or (dd < -200 and part_b):
				inm[y * w + x] = 1
	var closed := inm.duplicate()
	for y in range(r.position.y + 2, r.end.y - 2):
		for x in range(r.position.x + 2, r.end.x - 2):
			var k := y * w + x
			if inm[k] == 1:
				continue
			if (inm[k - 1] == 1 or inm[k - 2] == 1) and (inm[k + 1] == 1 or inm[k + 2] == 1) \
					or (inm[k - w] == 1 or inm[k - 2 * w] == 1) and (inm[k + w] == 1 or inm[k + 2 * w] == 1):
				closed[k] = 1
	return closed


## Silhouette read of the part inside `r`. `vis`: its visible pixels (the scene drawn around it); `full`: its whole
## outline (drawn alone), so decals and props standing on it, its own seams and the holes in it are not edges. Each
## edge pair is a visible part pixel next to an exterior pixel (outside the outline, reachable from the rect's border);
## it compares L* 2 px inside with L* 2 px outside (MSAA blends the edge pixel itself). Returns the mean (the read) and
## median |dL*| and the mean inner / outer L*. `dbg` (optional): paints
## each measured edge pixel from red (no contrast) to green (>= BAR_EDGE).
func _edge_read(img: Image, vis: PackedByteArray, full: PackedByteArray, r: Rect2i, dbg: Image = null) -> Dictionary:
	var w := img.get_width()
	var nd := img.get_data()
	var px := 0
	for y in range(r.position.y, r.end.y):
		for x in range(r.position.x, r.end.x):
			px += vis[y * w + x]
	# the exterior: what is outside the outline and reachable from the rect's border (not a hole or notch inside it)
	var ext := PackedByteArray()
	ext.resize(full.size())
	var stack := PackedInt32Array()
	for x in range(r.position.x, r.end.x):
		for y in [r.position.y, r.end.y - 1]:
			stack.append(y * w + x)
	for y in range(r.position.y, r.end.y):
		for x in [r.position.x, r.end.x - 1]:
			stack.append(y * w + x)
	while not stack.is_empty():
		var k: int = stack[stack.size() - 1]
		stack.resize(stack.size() - 1)
		var kx := k % w
		var ky := k / w
		if k < 0 or k >= full.size() or kx < r.position.x or kx >= r.end.x or ky < r.position.y or ky >= r.end.y:
			continue
		if ext[k] == 1 or full[k] == 1:
			continue
		ext[k] = 1
		stack.append(k + 1)
		stack.append(k - 1)
		stack.append(k + w)
		stack.append(k - w)
	var vals := PackedFloat32Array()
	var si := 0.0
	var so := 0.0
	var steps := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
	for y in range(r.position.y + 3, r.end.y - 3):
		for x in range(r.position.x + 3, r.end.x - 3):
			if vis[y * w + x] == 0:
				continue
			for st in steps:
				var q: Vector2i = Vector2i(x, y) + st
				if ext[q.y * w + q.x] == 0:
					continue
				var pin: Vector2i = Vector2i(x, y) - st * 2
				if vis[pin.y * w + pin.x] == 0:
					pin = Vector2i(x, y)
				var pout: Vector2i = q + st * 2
				if ext[pout.y * w + pout.x] == 0:
					pout = q
				var li := _lstar(nd, (pin.y * w + pin.x) * 3)
				var lo := _lstar(nd, (pout.y * w + pout.x) * 3)
				vals.append(absf(li - lo))
				if dbg != null:
					var k := clampf(absf(li - lo) / BAR_EDGE, 0.0, 1.0)
					dbg.set_pixel(x, y, Color(1.0 - k, k, 0.0))
				si += li
				so += lo
	if dbg != null and OS.get_environment("COVER_DEBUG") != "":
		var mi := Image.create(w, img.get_height(), false, Image.FORMAT_RGB8)
		for y in range(r.position.y, r.end.y):
			for x in range(r.position.x, r.end.x):
				var k := y * w + x
				mi.set_pixel(x, y, Color(vis[k], full[k] * 0.6, ext[k]))
		dbg.set_meta("masks", mi)
	var n := vals.size()
	if n == 0:
		return {"edge": 0.0, "median": 0.0, "inner": 0.0, "outer": 0.0, "px": px, "pairs": 0}
	var sum := 0.0
	for v in vals:
		sum += v
	vals.sort()
	return {"edge": sum / n, "median": vals[n / 2], "inner": si / n, "outer": so / n, "px": px, "pairs": n}

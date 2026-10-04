extends RefCounted
## W15 G-HUD §1 and §4 (docs/qa/w15/HUD_CONTRACT.md): the slab marker.
## 1. Words and shape per state (pure, hud.gd marker_spec / marker_lines / marker_shapes / marker_box): NEUTRAL is a
##    hollow white diamond; CORGI COMPANY / CAT CADRE a filled diamond in that team's colour, lightened; CONTESTED the
##    diamond's halves split by a bar, amber. The three shapes differ in their primitives, not only in colour, and the
##    two lines (`SLAB  <N> m`, the state word) sit above the shape.
## 2. Placement (pure, place_marker / behind_point; contract revision 3 "Placement, in this order"): a pet under the
##    marker lifts it clear, a stack of pets lifts it over all of them; the lift never takes the box above the safe top
##    (y 110: the scores, timer and slab line stay clear), and a pet it cannot clear upward sends it just below that
##    pet; with no room either way it keeps the lifted place (by the cap at most); off screen and behind the camera the
##    whole box (both lines and the shape) clamps inside the screen's safe area, toward the slab's side.
## 3. A 2v2 match, every Corgi and Cat spawn and respawn point (the data's), the play camera there facing the slab at
##    the respawn pitch and aimed at the slab, the three bots placed on the slab six ways (a row across the view, a file
##    along it, the Cats alone, the Corgi alone, two pets at the top of a jump, nobody): the marker is on screen, hangs at
##    the slab's centre + 4.5 m (or above it, lifted), reads `SLAB  <N> m` (the camera's ground distance) and the state
##    word, never covers a living pet's box on screen, nor the scores, the timer or the slab line, and lifts at most
##    MARKER_MAX_LIFT px; some views need the lift.
## 3b. Close and pitched down (revision 3; Sprint B found the box lifted over the timer at 14 m): the play camera 9 m and
##    14 m from the slab's centre on eight bearings, cam_pitch -0.6, the six arrangements: the box stays below the safe
##    top, off the scores, the timer and the slab line, and covers a pet only when the HUD reports step 4 ("blocked":
##    counted, not independently re-checked).
## 4. It hides while the player stands on the slab and shows again off it; it hides while the player is down and shows
##    after the respawn; once the match is over the marker and the slab line hide, and the rematch brings them back.
const Kit := preload("res://game/testkit.gd")
const T := preload("res://game/tuning.gd")
const Hud := preload("res://game/hud.gd")

const STATES := [
	[{"holder": -1, "contested": false, "counts": [0, 0]}, "NEUTRAL", "hollow"],
	[{"holder": 0, "contested": false, "counts": [1, 0]}, "CORGI COMPANY", "filled"],
	[{"holder": 1, "contested": false, "counts": [0, 2]}, "CAT CADRE", "filled"],
	[{"holder": -1, "contested": true, "counts": [1, 1]}, "CONTESTED", "split"],
]

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	errs.append_array(_words_and_shapes())
	errs.append_array(_placement())
	var log := Kit.watch()
	var main: Node = await Kit.boot(tree, {"human": true, "allies": 1, "enemies": 2, "think": false})
	var game: Node = main.get_node("Game")
	if not game.playing() or game.player == null or game.pets.size() != 4:
		errs.append("2v2 with the human did not start")
	else:
		errs.append_array(await _from_the_bases(tree, game))
		errs.append_array(await _close_views(tree, game))
		errs.append_array(await _hides(tree, game))
	errs.append_array(Kit.unwatch(log))
	await Kit.dispose(tree, main)
	return errs

## Primitive counts of a shape (marker_shapes / hit_cue): its fills' vertex counts, outlines, lines and rings.
static func signature(pr: Dictionary) -> String:
	var fills: Array = pr.fills.map(func(f): return f.size())
	return "fills %s outlines %d lines %d rings %d" % [str(fills), pr.outlines.size(), pr.lines.size(), pr.rings.size()]

func _words_and_shapes() -> Array:
	var e: Array = []
	var c := Vector2(400, 300)
	var r: float = Hud.MARKER_R
	var seen := {}
	for row in STATES:
		var spec: Dictionary = Hud.marker_spec(row[0])
		var lines: PackedStringArray = Hud.marker_lines(row[0], 42)
		if spec.word != row[1] or lines != PackedStringArray(["SLAB  42 m", row[1]]):
			e.append("state %s: words %s, want [SLAB  42 m, %s]" % [str(row[0]), str(lines), row[1]])
		if spec.shape != row[2]:
			e.append("state %s: shape %s, want %s" % [row[1], spec.shape, row[2]])
		var col: Color = spec.color
		var h := int(row[0].holder)
		if row[0].contested and not (col.r > col.g and col.g > col.b and col.h > 0.05 and col.h < 0.14 and col.s > 0.6):
			e.append("CONTESTED colour %s is not amber" % col.to_html(false))
		elif h >= 0:
			var team: Color = T.TEAM_COLORS[h]
			if absf(col.h - team.h) > 0.02 or col.get_luminance() <= team.get_luminance() + 0.05:
				e.append("%s colour %s is not its team colour %s lightened" % [row[1], col.to_html(false), team.to_html(false)])
		elif not row[0].contested and (col.s > 0.1 or col.v < 0.85):
			e.append("NEUTRAL colour %s is not white" % col.to_html(false))
		var pr: Dictionary = Hud.marker_shapes(spec.shape, c)
		var sig := signature(pr)
		seen[spec.shape] = sig
		match spec.shape:
			"hollow":
				if pr.outlines.size() != 1 or pr.outlines[0].size() != 4 or not pr.fills.is_empty():
					e.append("NEUTRAL is not a hollow diamond: %s" % sig)
			"filled":
				if pr.fills.size() != 1 or pr.fills[0].size() != 4 or not pr.outlines.is_empty():
					e.append("%s is not a filled diamond: %s" % [row[1], sig])
				elif absf(_area(pr.fills[0]) - 2.0 * r * r) > 1.0:
					e.append("%s: the filled diamond's area %.1f, want %.1f" % [row[1], _area(pr.fills[0]), 2.0 * r * r])
			"split":
				if pr.fills.size() != 3 or pr.fills[0].size() != 3 or pr.fills[1].size() != 3 or pr.fills[2].size() != 4:
					e.append("CONTESTED is not two halves and a bar: %s" % sig)
				else:
					var top := _bounds(pr.fills[0])
					var bottom := _bounds(pr.fills[1])
					var bar := _bounds(pr.fills[2])
					if bottom.position.y - top.end.y < 4.0:
						e.append("CONTESTED: the halves are %.1f px apart (want a split)" % (bottom.position.y - top.end.y))
					if bar.position.y < top.end.y or bar.end.y > bottom.position.y:
						e.append("CONTESTED: the bar is not in the split")
					if bar.size.x <= 2.0 * r + 4.0:
						e.append("CONTESTED: the bar (%.1f px) does not reach past the diamond's tips" % bar.size.x)
	if seen.size() != 3 or seen.hollow == seen.filled or seen.filled == seen.split or seen.hollow == seen.split:
		e.append("the three marker states do not differ in shape: %s" % str(seen))
	# the words sit above the shape
	var off: Rect2 = Hud.marker_box(Vector2(80, 20), Vector2(110, 21))
	if off.position.y > -(r + 41.0) or off.end.y < r or off.size.x < 110.0:
		e.append("marker box %s does not hold both lines (41 px) above the shape (%.0f px to a tip)" % [str(off), r])
	return e

func _placement() -> Array:
	var e: Array = []
	var screen := Rect2(0, 0, 1280, 720)
	var safe := Rect2(16, 110, 1248, 498)
	var off: Rect2 = Hud.marker_box(Vector2(80, 20), Vector2(110, 21))
	var a := Vector2(640, 300)
	var free: Dictionary = Hud.place_marker(a, off, [], safe, screen)
	if free.pos != a or free.lift != 0.0:
		e.append("no pet near: the marker moved from %s to %s" % [str(a), str(free.pos)])
	# a pet whose head is under the shape
	var pet := Rect2(630, 305, 30, 40)
	var one: Dictionary = Hud.place_marker(a, off, [pet], safe, screen)
	var box := Rect2(one.pos + off.position, off.size)
	if box.intersects(pet) or one.pos.x != a.x or one.lift <= 0.0:
		e.append("a pet under the marker: box %s still covers %s (lift %.1f)" % [str(box), str(pet), one.lift])
	if one.lift > (a.y + off.end.y) - pet.position.y + Hud.MARKER_CLEAR + 0.01:
		e.append("a pet under the marker: lifted %.1f px, more than it needed" % one.lift)
	# a pet stacked over the first one's new place: lifted over both
	var two := Rect2(600, box.position.y - 8.0, 20, 12)
	var both: Dictionary = Hud.place_marker(a, off, [pet, two], safe, screen)
	var box2 := Rect2(both.pos + off.position, off.size)
	if box2.intersects(pet) or box2.intersects(two):
		e.append("two stacked pets: the box %s still covers one" % str(box2))
	# a pet taller than the lift can clear: the marker goes just below it (contract step 3)
	var tall := Rect2(620, 100, 40, 300)
	var under: Dictionary = Hud.place_marker(a, off, [tall], safe, screen)
	var ub := Rect2(under.pos + off.position, off.size)
	if under.dodge != "below" or ub.intersects(tall) or absf(ub.position.y - (tall.end.y + Hud.MARKER_CLEAR)) > 0.01:
		e.append("a pet too tall to clear upward: box %s (%s), want its top at %.0f, just below the pet" % [str(ub),
			under.dodge, tall.end.y + Hud.MARKER_CLEAR])
	# no room above or below: it keeps the lifted place, by the cap at most (step 4)
	var wall := Rect2(600, 0, 80, 720)
	var stuck: Dictionary = Hud.place_marker(a, off, [wall], safe, screen)
	if stuck.dodge != "blocked" or absf(stuck.lift - Hud.MARKER_MAX_LIFT) > 0.01:
		e.append("a pet the marker cannot clear: %s, lift %.1f px, want blocked at the %.0f px cap" % [stuck.dodge, stuck.lift,
			Hud.MARKER_MAX_LIFT])
	# the lift never goes above the safe top, and the top HUD stays clear (Sprint B: close and pitched down, the anchor
	# far above the screen, a pet under the clamped box: it was lifted over the timer)
	var timer := Rect2(578, 23, 110, 42)
	var slab_line := Rect2(340, 76, 600, 26)
	var near: Dictionary = Hud.place_marker(Vector2(640, -300), off, [Rect2(600, 100, 80, 60)], safe, screen)
	var nb := Rect2(near.pos + off.position, off.size)
	if nb.position.y < safe.position.y - 0.01 or nb.intersects(timer) or nb.intersects(slab_line) or nb.intersects(Rect2(600, 100, 80, 60)):
		e.append("anchor (640, -300) with a pet under the clamped box: box %s (%s) leaves the safe top %.0f, covers the timer %s, the slab line %s or the pet" % [
			str(nb), near.dodge, safe.position.y, str(timer), str(slab_line)])
	for top in [Vector2(640, 130), Vector2(640, 175), Vector2(640, 260)]:  # some room above, less than the pet needs
		var pt := Rect2(610, top.y - 20.0, 60, 90)
		var r2: Dictionary = Hud.place_marker(top, off, [pt], safe, screen)
		var b2 := Rect2(r2.pos + off.position, off.size)
		if b2.position.y < safe.position.y - 0.01 or (r2.dodge != "blocked" and b2.intersects(pt)):
			e.append("anchor %s, pet %s: box %s (%s) leaves the safe top or covers the pet" % [str(top), str(pt), str(b2), r2.dodge])
	# off screen to the left, to the right and above: the whole box clamps inside the safe area, both lines kept
	for far in [Vector2(-900, 300), Vector2(2400, 500), Vector2(640, -700)]:
		var at: Dictionary = Hud.place_marker(far, off, [], safe, screen)
		var b := Rect2(at.pos + off.position, off.size)
		if not safe.grow(0.01).encloses(b):
			e.append("anchor %s off screen: the box %s leaves the safe area %s" % [str(far), str(b), str(safe)])
	# behind the camera (facing -Z): straight behind -> bottom edge, centred; behind and to the right -> its right half
	var cam := Transform3D(Basis(), Vector3(0, 2, 0))
	var back: Vector2 = Hud.behind_point(cam, Vector3(0, 4.5, 40), screen)
	var right: Vector2 = Hud.behind_point(cam, Vector3(30, 4.5, 30), screen)
	var pb: Dictionary = Hud.place_marker(back, off, [], safe, screen)
	var pr: Dictionary = Hud.place_marker(right, off, [], safe, screen)
	if absf(pb.pos.x - 640.0) > 1.0 or absf(pb.pos.y + off.end.y - safe.end.y) > 0.5:
		e.append("slab straight behind: the marker is at %s, want the bottom edge's centre" % str(pb.pos))
	if pr.pos.x < 900.0 or absf(pr.pos.y + off.end.y - safe.end.y) > 0.5:
		e.append("slab behind on the right: the marker is at %s, want the bottom edge's right side" % str(pr.pos))
	return e

## Every spawn and respawn point of both teams, the play camera facing the slab, the bots on the slab six ways.
func _from_the_bases(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var corgi: Node = game.pets.filter(func(p): return p != me and p.team == 0)[0]
	var cats: Array = game.pets.filter(func(p): return p.team == 1)
	for b in [corgi] + cats:
		b.set_physics_process(false)  # they stay where the test puts them, in the air too
	var c: Vector3 = game.slab.center
	var space: PhysicsDirectSpaceState3D = me.get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(c + Vector3(0, 5, 0), c - Vector3(0, 5, 0), T.L_WORLD))
	var floor_y: float = hit.position.y if not hit.is_empty() else c.y
	var screen := Rect2(0, 0, 1280, 720)
	var stats := [[0, 0, 0.0], [0, 0, 0.0]]  # per team: views, lifted views, largest lift
	for t in 2:
		var points: Array = []
		for sp in game.respawn_slots[t] + game.spawns[t]:
			if not points.any(func(q): return (q as Vector3).distance_to(sp) < 0.5):
				points.append(sp)
		for sp in points:
			var view := Vector3(c.x - sp.x, 0.0, c.z - sp.z).normalized()
			var across := Vector3(-view.z, 0.0, view.x)
			me.respawn(sp + Vector3(0, 0.05, 0), atan2(-view.x, -view.z))
			for aimed in [false, true]:
				if aimed:  # the crosshair on the slab's centre, 1 m up
					var pivot: Vector3 = me.global_position + Vector3(0, 1.45, 0)
					me.cam_pitch = atan2(c.y + 1.0 - pivot.y, Vector2(c.x - pivot.x, c.z - pivot.z).length())
				await Kit.physics(tree, 3)  # the boom and the spring arm settle
				var cam: Camera3D = me.camera
				for arr in _arrangements(c, floor_y, view, across, corgi, cats):
					for p in arr.at:
						p.global_position = arr.at[p]
					game.step_score(0.0)  # the slab state for this arrangement, no points
					var mk: Dictionary = hud.marker_frame(cam)
					var tag := "%s base (%.0f, %.0f)%s, %s" % [["Corgi", "Cat"][t], sp.x, sp.z, " aimed" if aimed else "", arr.name]
					stats[t][0] += 1
					if not mk.get("visible", false):
						e.append("%s: the marker is hidden" % tag)
						continue
					var cp := cam.global_position
					var want := "SLAB  %d m" % roundi(Vector2(cp.x - c.x, cp.z - c.z).length())
					if mk.lines[0] != want or mk.lines[1] != arr.word:
						e.append("%s: marker reads %s, want [%s, %s]" % [tag, str(mk.lines), want, arr.word])
					if not mk.onscreen or not screen.encloses(mk.rect):
						e.append("%s: the marker is off screen (%s)" % [tag, str(mk.rect)])
					var anchor := cam.unproject_position(c + Vector3(0, 4.5, 0))
					var pos: Vector2 = mk.pos
					if Vector2(mk.anchor).distance_to(anchor) > 0.5 or absf(pos.x - anchor.x) > 0.5 \
							or (pos.y > anchor.y + 0.5 and mk.dodge != "below"):
						e.append("%s: the marker hangs at %s, not at the slab's centre + 4.5 m (%s)" % [tag, str(pos), str(anchor)])
					e.append_array(_clear_of_top(hud, mk, tag))
					if mk.lift > Hud.MARKER_MAX_LIFT + 0.01:
						e.append("%s: lifted %.1f px (cap %.0f)" % [tag, mk.lift, Hud.MARKER_MAX_LIFT])
					if mk.lift > 0.5:
						stats[t][1] += 1
						stats[t][2] = maxf(stats[t][2], mk.lift)
					for p in game.pets:
						if p == me or not p.alive:
							continue  # the camera's own pet is the view itself
						var box := _screen_box(p, cam)
						var mr: Rect2 = mk.rect
						if box.has_area() and mr.intersects(box):
							e.append("%s: the marker %s covers %s at %s" % [tag, str(mk.rect), p.display_name, str(box)])
	for t in 2:
		print("  marker from the %s base: %d views, %d needed the lift (largest %.1f px)" % [["Corgi", "Cat"][t],
			stats[t][0], stats[t][1], stats[t][2]])
	if stats[0][1] + stats[1][1] == 0:
		e.append("no view from the bases needed the lift: the sweep does not exercise it")
	return e

## Close and pitched down (contract revision 3): the play camera 9 m and 14 m from the slab's centre on eight bearings,
## cam_pitch -0.6, the six arrangements. The box stays below the safe top and off the top HUD; it covers a pet only
## when the HUD reports step 4 ("blocked": counted, not independently re-checked).
func _close_views(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var corgi: Node = game.pets.filter(func(p): return p != me and p.team == 0)[0]
	var cats: Array = game.pets.filter(func(p): return p.team == 1)
	for b in [corgi] + cats:
		b.set_physics_process(false)
	var c: Vector3 = game.slab.center
	var space: PhysicsDirectSpaceState3D = me.get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(c + Vector3(0, 5, 0), c - Vector3(0, 5, 0), T.L_WORLD))
	var floor_y: float = hit.position.y if not hit.is_empty() else c.y
	var tally := {"views": 0, "none": 0, "lift": 0, "below": 0, "blocked": 0}
	for dist in [9.0, 14.0]:
		for k in 8:
			var d := Vector3(sin(TAU * k / 8.0), 0.0, cos(TAU * k / 8.0))
			var at: Vector3 = c + d * float(dist)
			var g := space.intersect_ray(PhysicsRayQueryParameters3D.create(at + Vector3(0, 20, 0), at - Vector3(0, 20, 0), T.L_WORLD))
			var spot: Vector3 = (g.position if not g.is_empty() else at) + Vector3(0, 0.05, 0)
			var view := -d
			var across := Vector3(-view.z, 0.0, view.x)
			me.respawn(spot, atan2(-view.x, -view.z))
			me.cam_pitch = -0.6
			await Kit.physics(tree, 3)
			var cam: Camera3D = me.camera
			for arr in _arrangements(c, floor_y, view, across, corgi, cats):
				for p in arr.at:
					p.global_position = arr.at[p]
				game.step_score(0.0)
				var mk: Dictionary = hud.marker_frame(cam)
				var tag := "%.0f m bearing %d deg, pitch -0.6, %s" % [dist, k * 45, arr.name]
				tally.views += 1
				if not mk.get("visible", false):
					e.append("%s: the marker is hidden (player at %s)" % [tag, str(me.global_position)])
					continue
				tally[mk.dodge] += 1
				e.append_array(_clear_of_top(hud, mk, tag))
				var mr: Rect2 = mk.rect
				for p in game.pets:
					if p == me or not p.alive:
						continue
					var box := _screen_box(p, cam)
					if box.has_area() and mr.intersects(box) and mk.dodge != "blocked":
						e.append("%s: the marker %s (%s) covers %s at %s" % [tag, str(mr), mk.dodge, p.display_name, str(box)])
	print("  marker close and pitched down: %d views; placed as anchored %d, lifted %d, below a pet %d, blocked %d" % [
		tally.views, tally.none, tally.lift, tally.below, tally.blocked])
	return e

## The marker's box stays at or below the safe top and off the scores, the timer and the slab line (their own rects).
static func _clear_of_top(hud: Node, mk: Dictionary, tag: String) -> Array:
	var e: Array = []
	var mr: Rect2 = mk.rect
	if mr.position.y < Hud.MARKER_SAFE[1] - 0.01:
		e.append("%s: the marker's box %s rises above the safe top %.0f (%s)" % [tag, str(mr), Hud.MARKER_SAFE[1], mk.dodge])
	for l in [hud._score[0], hud._score[1], hud._timer, hud._slab]:
		var r: Rect2 = (l as Control).get_global_rect()
		if mr.intersects(r):
			e.append("%s: the marker's box %s covers '%s' at %s" % [tag, str(mr), (l as Label).text, str(r)])
	return e

## The bots on the slab, six ways. `word` is the state word the marker must show.
func _arrangements(c: Vector3, y: float, view: Vector3, across: Vector3, corgi: Node, cats: Array) -> Array:
	var g := Vector3(c.x, y, c.z)
	var away := g + across * 30.0  # off the slab, beside the view
	return [
		{"name": "a row across the view", "word": "CONTESTED", "at": {corgi: g + across * 0.9, cats[0]: g - across * 0.9, cats[1]: g}},
		{"name": "a file along the view", "word": "CONTESTED", "at": {corgi: g - view * 3.0, cats[0]: g, cats[1]: g + view * 3.0}},
		{"name": "the Cats alone", "word": "CAT CADRE", "at": {corgi: away, cats[0]: g + across * 1.5, cats[1]: g - across * 1.5}},
		{"name": "the Corgi alone", "word": "CORGI COMPANY", "at": {corgi: g, cats[0]: away + view * 4.0, cats[1]: away - view * 4.0}},
		{"name": "two at the top of a jump", "word": "CONTESTED",
			"at": {corgi: g + across * 1.2 + Vector3(0, 1.45, 0), cats[0]: g + Vector3(0, 1.85, 0), cats[1]: g - across * 1.5}},
		{"name": "nobody", "word": "NEUTRAL", "at": {corgi: away, cats[0]: away + view * 4.0, cats[1]: away - view * 4.0}},
	]

## A pet's box on screen, measured here (not by the HUD): the 8 corners of its model mesh's bounds through `cam`.
static func _screen_box(p: Node, cam: Camera3D) -> Rect2:
	var mi: MeshInstance3D = p.model.get_node("Body")
	var ab := mi.get_aabb()
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for i in 8:
		var w: Vector3 = mi.global_transform * ab.get_endpoint(i)
		if cam.is_position_behind(w):
			return Rect2()
		var s := cam.unproject_position(w)
		lo = lo.min(s)
		hi = hi.max(s)
	return Rect2(lo, hi - lo)

func _hides(tree: SceneTree, game: Node) -> Array:
	var e: Array = []
	var hud: Node = game.hud
	var me: Node = game.player
	var c: Vector3 = game.slab.center
	me.respawn(c + Vector3(1.0, 0.2, 1.0), 0.0)
	await Kit.physics(tree, 3)
	await tree.process_frame
	await tree.process_frame
	if not game.slab.contains(me.global_position):
		e.append("could not stand the player on the slab (at %s)" % str(me.global_position))
	elif hud.marker.get("visible", false) or hud.marker_frame(me.camera).get("visible", false):
		e.append("the marker shows while the player stands on the slab")
	me.respawn(c + Vector3(0, 0.2, 12.0), 0.0)
	await Kit.physics(tree, 3)
	await tree.process_frame
	await tree.process_frame
	if not hud.marker.get("visible", false):
		e.append("the marker is hidden with the player 12 m off the slab")
	if not hud._slab.visible:
		e.append("the slab line is hidden during play")
	# down: hidden (the death panel gives the distance from the respawn); back up: shown
	me.die(null)
	await tree.process_frame
	await tree.process_frame
	if hud.marker.get("visible", false):
		e.append("the marker shows while the player is down")
	var waited := 0
	while not me.alive and waited < int((T.RESPAWN_TIME + 1.0) * 60.0):
		await tree.physics_frame
		waited += 1
	await tree.process_frame
	await tree.process_frame
	if not me.alive or not hud.marker.get("visible", false):
		e.append("the marker is hidden after the respawn (alive %s)" % me.alive)
	game.end_match(0)
	await tree.process_frame
	await tree.process_frame
	if hud._slab.visible:
		e.append("the slab line (%s) still shows once the match is won" % hud._slab.text)
	if hud.marker.get("visible", false) or hud.marker_frame(me.camera).get("visible", false):
		e.append("the slab marker still shows once the match is won")
	if not hud._winner.visible:
		e.append("the winner screen is not up")
	game.rematch()
	await tree.process_frame
	await tree.process_frame
	if not hud._slab.visible or not hud.marker.get("visible", false):
		e.append("after the rematch the slab line (%s) or the marker (%s) is still hidden" % [hud._slab.visible,
			hud.marker.get("visible", false)])
	return e

static func _area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size():
		s += p[i].cross(p[(i + 1) % p.size()])
	return absf(s) * 0.5

static func _bounds(p: PackedVector2Array) -> Rect2:
	var r := Rect2(p[0], Vector2.ZERO)
	for q in p:
		r = r.expand(q)
	return r

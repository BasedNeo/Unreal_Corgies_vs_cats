extends RefCounted
## G-WORLD (W12): The Lot builds from data/the_lot.json and matches it. The world is built on its own (world/world.gd),
## not through main.tscn, so another lane's work in progress cannot fail these checks.
##   - it builds and emits `built`; all six kit GLBs load; each piece is one MultiMesh with the JSON's instance count;
##     no COL_ node is in the tree; one shadows-only KitShadow;
##   - the terrain collider is the sim's surface: 16 probes where the sim's b-c split and the other diagonal differ by
##     10-31 cm hit within 1 cm of the sim's height;
##   - colliders turn like the sim (Euler YXZ): the most turned box's corners within 1 mm of three.js's;
##   - a ray down at each of the 32 spawns hits ground within 2 m;
##   - the slab is walkable ground: level-enough hits at its centre and corners, nothing standing on it, on the nav mesh;
##   - the baked nav mesh has a path from every spawn of both teams to the slab.

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var world = load("res://world/world.gd").new()
	var fired := [false]
	world.built.connect(func(): fired[0] = true)
	tree.root.add_child(world)
	for i in 30:
		if fired[0]:
			break
		await tree.process_frame
	if not fired[0] or not world.is_built:
		world.queue_free()
		return ["world never emitted built"]
	print("  world build ms: ", world.timings)
	var data: Dictionary = world.data

	# ---- kit: every piece loaded, one MultiMesh each, instance counts from the JSON, COL_ never in the tree
	if world.kit_loaded.size() != 6 or data.kit.size() != 6:
		errs.append("kit loaded %d/%d: failed %s" % [world.kit_loaded.size(), data.kit.size(), world.kit_failed])
	for p in data.kit:
		var mmi: MultiMeshInstance3D = world.kit_nodes.get(p.name)
		if mmi == null or mmi.multimesh == null:
			errs.append("%s: no MultiMeshInstance3D" % p.name)
			continue
		if mmi.multimesh.instance_count != p.placements.size():
			errs.append("%s: %d instances, JSON %d" % [p.name, mmi.multimesh.instance_count, p.placements.size()])
		if mmi.multimesh.mesh == null or mmi.multimesh.mesh.get_surface_count() != 1:
			errs.append("%s: mesh is not one LOD0 surface" % p.name)
		if not mmi.is_in_group("kit"):
			errs.append("%s: not in group kit" % p.name)
		if mmi.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			errs.append("%s casts its own shadow (KitShadow should)" % p.name)
		# every placement lands where the JSON says (x, y, z), turned by its yaw
		var xfs: Array = world.kit_xforms.get(p.name, [])
		for i in mini(xfs.size(), p.placements.size()):
			var r: Array = p.placements[i]
			var o: Vector3 = xfs[i].origin
			var fwd: Vector3 = xfs[i].basis.z
			if o.distance_to(Vector3(r[0], r[1], r[2])) > 1e-3 or absf(angle_difference(atan2(fwd.x, fwd.z), r[3])) > 1e-3:
				errs.append("%s instance %d at %s yaw %.4f, JSON %s" % [p.name, i, o, atan2(fwd.x, fwd.z), r])
	var shadows: Array = world.find_children("KitShadow", "MeshInstance3D", true, false)
	if shadows.size() != 1 or shadows[0].cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY:
		errs.append("want one shadows-only KitShadow, found %d" % shadows.size())
	for n in world.find_children("COL_*", "", true, false):
		errs.append("COL_ node in the world tree: %s" % n.get_path())
	for g in ["ground", "kit", "prims", "world_static"]:
		if tree.get_nodes_in_group(g).is_empty():
			errs.append("group %s is empty" % g)

	await tree.physics_frame
	await tree.physics_frame
	var space: PhysicsDirectSpaceState3D = world.get_world_3d().direct_space_state

	# ---- terrain collider == the sim's triangulated surface
	for pr in data.checks.terrainProbes:
		var hit := _down(space, Vector3(pr[0], 60, pr[1]), 200.0)
		if hit.is_empty() or absf(hit.position.y - pr[2]) > 0.01:
			errs.append("terrain probe (%s, %s): hit %s, sim %s" % [pr[0], pr[1], hit.get("position", "none"), pr[2]])

	# ---- colliders turn like the sim
	var tb: Dictionary = data.checks.turnedBox
	var box: Array = data.colliders.boxes[int(tb.index)]
	var cs: CollisionShape3D = world.get_node("Colliders").get_child(int(tb.index))
	var half: Vector3 = (cs.shape as BoxShape3D).size / 2.0
	var k := 0
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			for sz in [-1, 1]:
				var c: Vector3 = cs.transform * Vector3(sx * half.x, sy * half.y, sz * half.z)
				var w := Vector3(tb.corners[k][0], tb.corners[k][1], tb.corners[k][2])
				if c.distance_to(w) > 1e-3:
					errs.append("turned box %s corner %d: %s, sim %s" % [box[0], k, c, w])
				k += 1

	# ---- spawns stand on ground
	for team in [0, 1]:
		var pts: Array[Vector3] = world.spawn_points(team)
		if pts.size() != 16:
			errs.append("team %d has %d spawns, want 16" % [team, pts.size()])
		for s in pts:
			var hit := _down(space, s + Vector3.UP, 3.0)
			if hit.is_empty() or s.y - hit.position.y > 2.0 or s.y - hit.position.y < -0.05:
				errs.append("spawn %s (team %d): ground hit %s" % [s, team, hit.get("position", "none")])

	# ---- the slab: walkable ground, nothing on it
	var slab: Dictionary = world.slab()
	var c0: Vector3 = slab.center
	var size: Vector2 = slab.size
	var min_ny: float = cos(deg_to_rad(world.NAV_AGENT.slope))
	for off in [Vector2.ZERO, Vector2(-1, -1), Vector2(1, -1), Vector2(-1, 1), Vector2(1, 1)]:
		var at := c0 + Vector3(off.x * (size.x / 2 - 0.5), 0, off.y * (size.y / 2 - 0.5))
		var hit := _down(space, at + Vector3.UP * 5, 10.0)
		if hit.is_empty() or hit.collider.name != "GroundBody" or hit.normal.y < min_ny or absf(hit.position.y - c0.y) > 0.5:
			errs.append("slab point %s: hit %s" % [at, hit])
	var q := PhysicsShapeQueryParameters3D.new()
	var probe := BoxShape3D.new()
	probe.size = Vector3(size.x, 1.8, size.y)
	q.shape = probe
	q.transform = Transform3D(Basis.IDENTITY, c0 + Vector3(0, float(data.slab.groundMax) - c0.y + 0.2 + 0.9, 0))
	q.collision_mask = 1
	for h in space.intersect_shape(q, 8):
		errs.append("slab is not clear: %s" % h.collider.name)

	# ---- navigation: a baked mesh with a path from every spawn to the slab
	var region: NavigationRegion3D = world.nav_region()
	if region == null or region.navigation_mesh == null or region.navigation_mesh.get_polygon_count() == 0:
		errs.append("no baked navigation mesh")
		world.queue_free()
		return errs
	var map := region.get_navigation_map()
	for i in 300:
		if world.nav_ready():
			break
		await tree.physics_frame
	if not world.nav_ready():
		errs.append("the navigation map never served the baked mesh")
	var on_mesh := NavigationServer3D.map_get_closest_point(map, c0)
	if on_mesh.distance_to(c0) > 0.6:
		errs.append("slab centre is off the nav mesh (closest %s)" % on_mesh)
	var worst := 0.0
	for team in [0, 1]:
		for s in world.spawn_points(team):
			var path := NavigationServer3D.map_get_path(map, s, c0, true)
			var miss := 1e9 if path.is_empty() else Vector2(path[-1].x - c0.x, path[-1].z - c0.z).length()
			var start := 1e9 if path.is_empty() else Vector2(path[0].x - s.x, path[0].z - s.z).length()
			worst = maxf(worst, maxf(miss, start))
			if miss > 0.6 or start > 1.0:
				errs.append("no nav path team %d spawn %s -> slab (ends %.2f m off, starts %.2f m off)" % [team, s, miss, start])
	print("  nav: %d polygons, worst path end/start gap %.2f m" % [region.navigation_mesh.get_polygon_count(), worst])
	world.queue_free()
	await tree.process_frame
	return errs


func _down(space: PhysicsDirectSpaceState3D, from: Vector3, dist: float) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * dist, 1)
	return space.intersect_ray(q)

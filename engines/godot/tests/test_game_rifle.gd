extends RefCounted
## G-GAME: the rifle ray damages a target in front, not one behind cover and not one behind the shooter; falloff and
## the head zone follow weapons.ts (squeaker_rifle).
const Kit := preload("res://game/testkit.gd")
const Pet := preload("res://game/pet.gd")
const Rifle := preload("res://game/rifle.gd")
const T := preload("res://game/tuning.gd")

func _pet(root: Node3D, team: int, pos: Vector3) -> Node:
	var p = Pet.new()
	p.configure(team, team, "P%d" % root.get_child_count(), null)
	root.add_child(p)
	p.global_position = pos
	return p

func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var log := Kit.watch()
	var root := Node3D.new()
	root.position = Vector3(0, 500, 0)  # far above anything else in the tree
	tree.root.add_child(root)
	var base := root.global_position
	var shooter: Node = _pet(root, 0, base)
	var front: Node = _pet(root, 1, base + Vector3(0, 0, -10))
	var covered: Node = _pet(root, 1, base + Vector3(4, 0, -10))
	var behind: Node = _pet(root, 1, base + Vector3(0, 0, 10))
	var wall := StaticBody3D.new()
	wall.collision_layer = T.L_WORLD
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(2, 3, 0.4)
	cs.shape = box
	wall.add_child(cs)
	root.add_child(wall)
	wall.global_position = base + Vector3(4, 1.5, -5)
	await Kit.physics(tree, 3)
	var rifle: Node = shooter.rifle
	var o := base + Vector3(0, 0.8, 0)
	var res: Dictionary = rifle.shoot(o, (front.chest() - o).normalized(), 0.0)
	if res.is_empty() or res.target != front:
		errs.append("shot at the target in front did not hit it (%s)" % str(res))
	if front.hp >= T.MAX_HP:
		errs.append("target in front took no damage (hp %.1f)" % front.hp)
	elif absf((T.MAX_HP - front.hp) - float(T.RIFLE.damage)) > 0.01:
		errs.append("body hit at 10 m did %.2f, expected %.2f" % [T.MAX_HP - front.hp, T.RIFLE.damage])
	if behind.hp < T.MAX_HP:
		errs.append("target behind the shooter was damaged")
	rifle.cooldown = 0.0
	rifle.bloom = 0.0
	var o2 := base + Vector3(4, 0.8, 0)
	var res2: Dictionary = rifle.shoot(o2, (covered.chest() - o2).normalized(), 0.0)
	if covered.hp < T.MAX_HP:
		errs.append("target behind cover was damaged (hp %.1f)" % covered.hp)
	if res2.is_empty() or not res2.hit or res2.target != null:
		errs.append("shot at the covered target did not stop on the wall (%s)" % str(res2))
	# fire-rate cap: an immediate second shot is refused
	var again: Dictionary = rifle.shoot(o, Vector3.FORWARD, 0.0)
	if not again.is_empty():
		errs.append("rifle fired twice inside 1/%d s" % int(T.RIFLE.fire_rate))
	# head zone + falloff (weapons.ts: headMult 1.6; full to 24 m, 0.6x from 48 m)
	rifle.cooldown = 0.0
	var hp0: float = front.hp
	var head: Vector3 = front.global_position + Vector3(0, T.height(front.species) * 0.95, 0)
	rifle.shoot(o, (head - o).normalized(), 0.0)
	if absf((hp0 - front.hp) - float(T.RIFLE.damage) * float(T.RIFLE.head_mult)) > 0.01:
		errs.append("head hit did %.2f, expected %.2f" % [hp0 - front.hp, float(T.RIFLE.damage) * float(T.RIFLE.head_mult)])
	if absf(Rifle.damage_at(10.0) - 15.0) > 1e-4 or absf(Rifle.damage_at(60.0) - 9.0) > 1e-4 or absf(Rifle.damage_at(36.0) - 12.0) > 1e-4:
		errs.append("falloff: %.2f @10 m, %.2f @36 m, %.2f @60 m (want 15, 12, 9)" % [Rifle.damage_at(10.0), Rifle.damage_at(36.0), Rifle.damage_at(60.0)])
	errs.append_array(Kit.unwatch(log))
	root.queue_free()
	await tree.process_frame
	return errs

extends RefCounted
## The main scene loads, the world emits `built`, and the look is the locked one (Wave 12).
func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var packed: PackedScene = load("res://main.tscn")
	if packed == null:
		return ["res://main.tscn missing"]
	var main := packed.instantiate()
	var world := main.get_node_or_null("World")
	if world == null:
		return ["main.tscn has no World"]
	var built := [false]
	world.built.connect(func(): built[0] = true)
	tree.root.add_child(main)
	for i in 600:
		if built[0]:
			break
		await tree.process_frame
	if not built[0]:
		errs.append("World never emitted built")
	var look = main.get_node_or_null("Look")
	if look == null or look.get("LOOK") != "stylised-realistic":
		errs.append("look is not stylised-realistic")
	main.queue_free()
	await tree.process_frame
	return errs

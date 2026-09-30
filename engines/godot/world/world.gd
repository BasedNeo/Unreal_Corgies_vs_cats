extends Node3D
## World (lane G-WORLD owns this folder). Builds The Lot from res://data/the_lot.json and the shared kit GLBs in
## ../../assets/masters (loaded at runtime with GLTFDocument: one source of truth, no copies). Skeleton stub: a flat
## ground so the project already boots.
signal built

func _ready() -> void:
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(80, 80)
	ground.mesh = plane
	ground.add_to_group("ground")
	add_child(ground)
	built.emit()

## Contract for game/ and look/ (see engines/godot/README.md).
func spawn_points(_team: int) -> Array[Vector3]:
	return [Vector3(0, 1, 5)]

func slab() -> Dictionary:
	return {"center": Vector3.ZERO, "size": Vector2(8, 8)}

func floodlights() -> Array:
	return []

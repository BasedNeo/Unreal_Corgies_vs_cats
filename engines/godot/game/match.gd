extends Node
## Game (lane G-GAME owns this folder): the player, the rifle, the bot, the slab score, the HUD and rematch.
## Skeleton stub: a camera over the world so the project already boots.

func _ready() -> void:
	var cam := Camera3D.new()
	cam.position = Vector3(0, 6, 14)
	get_parent().add_child.call_deferred(cam)
	cam.look_at_from_position.call_deferred(cam.position, Vector3.ZERO)

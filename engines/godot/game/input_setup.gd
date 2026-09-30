extends Node
## Input map, defined in code (lane G-GAME). Skeleton: the actions exist; bindings follow.
func _ready() -> void:
	for a in ["move_forward", "move_back", "move_left", "move_right", "jump", "fire", "rematch"]:
		if not InputMap.has_action(a):
			InputMap.add_action(a)

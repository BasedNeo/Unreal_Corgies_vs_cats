extends Node
## Look (lane G-LOOK owns this folder): stylised-realistic wet night (LOOK LOCKED, Wave 12). No ink outlines.
## Skeleton stub: a night environment and one key light.
const LOOK := "stylised-realistic"

func _ready() -> void:
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.03, 0.04, 0.06)
	env.environment.ambient_light_color = Color(0.25, 0.28, 0.35)
	add_child(env)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-50, 30, 0)
	key.light_energy = 0.4
	add_child(key)

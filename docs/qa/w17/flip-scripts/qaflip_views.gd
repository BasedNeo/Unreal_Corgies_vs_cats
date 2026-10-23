extends SceneTree
## QA-FLIP (docs/qa/w17/QA-FLIP.md): G-SKY's skyshot views (spawn, slab10, slab30, hero: same eyes, targets, fov 72,
## far 1000, 20 settle frames) rendered for FLIP. Run from a PRIVATE archive copy's engines/godot (copy this file there;
## it never lives under engines/godot in the repo): see render.sh beside it. env MASK_DIR = the output folder.
## Default: the sky MASK: white where the depth buffer holds nothing nearer than 0.98 x far (the sky; rain over the sky
## too, as it writes no depth), black where it holds geometry. NO_MASK=1: the normal frames (the before/after views).
const VIEWS := {
	"spawn": [Vector3(-63.6, -0.6, -113.8), Vector3(0, -6, 0), false],
	"slab10": [Vector3(0, 0, -10), Vector3(0, 0.6, 0), true],
	"slab30": [Vector3(0, 0, -30), Vector3(0, 0.6, 0), true],
	"hero": [Vector3(0, 0, -10), Vector3(-12, 40, 72), true],
}
const MASK_SHADER := """shader_type spatial;
render_mode unshaded, fog_disabled, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform float cam_far = 1000.0;
void vertex() { POSITION = vec4(VERTEX.xy, 0.5, 1.0); }
void fragment() {
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	vec3 ndc = vec3(SCREEN_UV, depth) * 2.0 - 1.0;
#else
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, depth);
#endif
	vec4 v = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	ALBEDO = -v.z / v.w >= 0.98 * cam_far ? vec3(1.0) : vec3(0.0);
}
"""
func _init() -> void:
	_go.call_deferred()
func _go() -> void:
	var host := Node3D.new()
	var world: Node3D = load("res://world/world.gd").new()
	world.name = "World"
	host.add_child(world)
	var look: Node = load("res://look/look.gd").new()
	look.name = "Look"
	host.add_child(look)
	var cam := Camera3D.new()
	cam.fov = 72.0
	cam.far = 1000.0
	host.add_child(cam)
	root.add_child(host)
	var ok := [false]
	look.applied.connect(func(): ok[0] = true)
	for i in 1200:
		if ok[0]:
			break
		await process_frame
	cam.current = true
	var mat := ShaderMaterial.new()
	mat.shader = Shader.new()
	mat.shader.code = MASK_SHADER
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(2, 2)
	q.mesh = qm
	q.material_override = mat
	q.extra_cull_margin = 16384.0
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if OS.get_environment("NO_MASK") == "": cam.add_child(q)
	q.position = Vector3(0, 0, -1) if q.is_inside_tree() else Vector3.ZERO
	var dir := OS.get_environment("MASK_DIR")
	for v in VIEWS.keys():
		var e: Vector3 = VIEWS[v][0]
		if VIEWS[v][2]:
			e.y = world.ground_height(e.x, e.z) + 1.5
		cam.look_at_from_position(e, VIEWS[v][1], Vector3.UP)
		for i in 20:
			await RenderingServer.frame_post_draw
		var img := root.get_texture().get_image()
		img.convert(Image.FORMAT_RGB8)
		img.save_png(dir.path_join("%s.png" % v))
		print("MASK %s eye %s size %s" % [v, e, img.get_size()])
	quit(0)

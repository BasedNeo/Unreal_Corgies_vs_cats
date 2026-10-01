extends Node
## Look (lane G-LOOK owns this folder): stylised-realistic wet night on The Lot (LOOK LOCKED, Wave 12). No ink outlines.
## Wave 13 (G-ATMOS): a night sky (not dusk), wet asphalt (not mud), sodium pools that read from the play cameras, and
## the Forward+-only effects (SSR, volumetric fog) requested only on Forward+.
## - Environment: moonlit overcast night sky shader, height + distance fog (volumetric on Forward+), AgX, glow on
##   emissives only (HDR threshold), SSAO, SSR (Forward+ only), a muted teal/warm grade.
## - One sodium SpotLight3D per World.floodlights() entry (shadows on a few), an emissive lens on the FloodLamp piece.
## - Wet asphalt shader on group `ground`; `kit` and `prims` materials darkened and smoothed in place (maps kept); the
##   ditch water (group `water`) a dark, still mirror.
## - pet_material(kind, species, team) for G-GAME; cheap rain around the camera.
## Materials go on after World.built (or at once if the world was already built when the look woke up).
## Command line (after `--`): `--look off` (the skeleton look, for A/B), `--look-quality low|medium|high`,
## `--look-stats` (prints draws / frame time at the end of a `--shot` run).
const LOOK := "stylised-realistic"
enum Quality { LOW, MEDIUM, HIGH }
const SODIUM := Color(1.0, 0.62, 0.28)  # high-pressure sodium, ~2100 K
const MOON_DIR := Vector3(-0.4, 0.55, -0.73)  # towards the moon (behind the cloud deck, seen through a break)
# The night's key values (sRGB colours). docs/handoff/G-ATMOS.md lists them for the web twin.
const SKY_ZENITH := Color(0.03, 0.042, 0.08)
const SKY_HORIZON := Color(0.11, 0.13, 0.17)  # the fog colour too: far silhouettes sink into the horizon haze
const MOON_COLOR := Color(0.62, 0.72, 0.95)
const FLOOD_ENERGY := 38.0
const WET_DARKEN := 0.7
const WET_ROUGH := 0.55
const PetMaterials := preload("res://look/pet_materials.gd")
const GROUND_SHADER := preload("res://look/wet_ground.gdshader")
const SKY_SHADER := preload("res://look/night_sky.gdshader")
const KIT_SHADER := preload("res://look/kit_wet.gdshader")
const PRIMS_SHADER := preload("res://look/prims_wet.gdshader")
const LENS_ENERGY := 9.0

signal applied

var enabled := true
var quality: int = Quality.HIGH
var raining := true
var environment: Environment
var moon: DirectionalLight3D
var floods: Array[SpotLight3D] = []
var _world: Node
var _world_env: WorldEnvironment
var _flood_root: Node3D
var _practical_root: Node3D
var _rain: GPUParticles3D
var _ground_mat: ShaderMaterial
var _water_mat: StandardMaterial3D
var _sky_mat: ShaderMaterial
var _wet := {}
var _lens := {}
var _streaks: NoiseTexture2D
var _applied := false
var _pets: RefCounted
var _forward_plus := true
## The rendering method the look builds for. Empty: RenderingServer's, read in _ready (a test may set it first).
var rendering_method := ""
var _stats := false
var _stat_frames := 90
var _n := 0
var _t0 := 0


func _ready() -> void:
	if rendering_method == "":
		rendering_method = RenderingServer.get_current_rendering_method()
	_forward_plus = rendering_method == "forward_plus"
	quality = Quality.HIGH if _forward_plus else Quality.MEDIUM
	_parse_args()
	_pets = PetMaterials.new()
	_pets.forward_plus = _forward_plus
	_world = _find_world()
	if not enabled:
		_skeleton_look()
		set_process(_stats)
		return
	_build_environment()
	_build_rain()
	if _world != null and _world.has_signal("built"):
		_world.built.connect(apply)
	_apply_if_already_built.call_deferred()
	set_process(true)


func _parse_args() -> void:
	var a := OS.get_cmdline_user_args()
	for i in a.size():
		var v: String = a[i + 1] if i + 1 < a.size() else ""
		match a[i]:
			"--look": enabled = v != "off"
			"--look-quality": quality = {"low": Quality.LOW, "medium": Quality.MEDIUM, "high": Quality.HIGH}.get(v, quality)
			"--look-stats": _stats = true
			"--frames": _stat_frames = int(v)


func _find_world() -> Node:
	var p := get_parent()
	if p == null:
		return null
	var w := p.get_node_or_null("World")
	if w != null:
		return w
	for c in p.get_children():
		if c.has_signal("built") and c.has_method("floodlights"):
			return c
	return null


func _apply_if_already_built() -> void:
	if _applied:
		return
	var b = _world.get("is_built") if _world != null else null
	if b == true or (b == null and not get_tree().get_nodes_in_group("ground").is_empty()):
		apply()


## Public: materials and floodlights over whatever the world holds now. Idempotent (safe to call again).
func apply() -> void:
	if not enabled:
		return
	for n in get_tree().get_nodes_in_group("ground"):
		for g in _geometry(n):
			g.material_override = _ground_material()
			# the heightfield is ~200k triangles: re-drawing it into every shadow pass tripled the primitives for
			# almost no visible shadow at night (the kit keeps its own shadow caster)
			g.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for grp in ["kit", "prims"]:
		for n in get_tree().get_nodes_in_group(grp):
			for g in _geometry(n):
				_wet_instance(g, grp)
	for n in get_tree().get_nodes_in_group("water"):
		for g in _geometry(n):
			g.material_override = _water_material()
	_lamp_lenses()
	_build_floods()
	_build_practicals()
	_applied = true
	applied.emit()


## Public: the pet materials G-GAME asks for. kind: coat | plate | metal; species 0 corgi, 1 cat; team 0 / 1.
func pet_material(kind: String, species: int, team: int) -> Material:
	if _pets == null:
		_pets = PetMaterials.new()
	return _pets.get_material(kind, species, team)


## Public quality knob (LOW: no volumetrics / SSR / SSAO / rain / flood shadows; MEDIUM; HIGH). SSR and volumetric fog
## exist only on Forward+ (see features()).
func set_quality(q: int) -> void:
	quality = clampi(q, Quality.LOW, Quality.HIGH)
	if enabled and environment != null:
		_apply_quality()
		_build_floods()


# ------------------------------------------------------------------------------------------------ environment
## Which costly effects a renderer and quality get. SSR and volumetric fog exist only on Forward+: requesting them on
## Compatibility (or Mobile) prints an engine warning and does nothing, so they are never requested there.
static func features(method: String, q: int) -> Dictionary:
	var fplus := method == "forward_plus"
	var mid := q >= Quality.MEDIUM
	return {"ssao": mid, "ssr": fplus and mid, "volumetric_fog": fplus and mid, "rain": mid,
		"flood_shadows": [0, 2, 4][clampi(q, Quality.LOW, Quality.HIGH)]}


func _build_environment() -> void:
	environment = Environment.new()
	var e := environment
	_sky_mat = ShaderMaterial.new()
	_sky_mat.shader = SKY_SHADER
	_sky_mat.set_shader_parameter("cloud_noise", _noise_tex(512, 0.008, 7, 5, false))
	_sky_mat.set_shader_parameter("moon_dir", MOON_DIR)
	_sky_mat.set_shader_parameter("zenith_color", SKY_ZENITH)
	_sky_mat.set_shader_parameter("horizon_color", SKY_HORIZON)
	var sky := Sky.new()
	sky.sky_material = _sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	# ambient: half the (now dark) sky, half a cold moonlit fill, so pets and the slab stay readable off the floods
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_color = Color(0.2, 0.25, 0.36)
	e.ambient_light_sky_contribution = 0.5
	e.ambient_light_energy = 1.6
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	e.tonemap_mode = Environment.TONE_MAPPER_AGX
	e.tonemap_exposure = 1.5
	e.tonemap_agx_contrast = 1.3  # a little deeper night blacks than the default 1.25
	# glow only on emissives: HDR threshold above anything lit, no bloom of the whole frame
	e.glow_enabled = true
	e.glow_hdr_threshold = 1.3
	e.glow_intensity = 0.7
	e.glow_bloom = 0.0
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
	# distance fog the colour of the horizon haze, plus a low ground mist
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	e.fog_light_color = SKY_HORIZON
	e.fog_light_energy = 1.0
	e.fog_density = 0.0045  # ~59 % at 200 m: the far side of the Lot stays a silhouette, not a wall
	e.fog_sky_affect = 0.15
	e.fog_aerial_perspective = 0.3
	e.fog_height = 1.0
	e.fog_height_density = 0.03
	# muted palette, slight grade: desaturate, a touch of contrast, teal shadows / warm highlights
	e.adjustment_enabled = true
	e.adjustment_brightness = 1.0
	e.adjustment_contrast = 1.06
	e.adjustment_saturation = 0.85
	e.adjustment_color_correction = _grade()
	_world_env = WorldEnvironment.new()
	_world_env.name = "Env"
	_world_env.environment = e
	add_child(_world_env)
	moon = DirectionalLight3D.new()
	moon.name = "Moon"
	moon.light_color = MOON_COLOR
	moon.light_energy = 0.5
	moon.light_angular_distance = 2.5
	moon.light_volumetric_fog_energy = 0.25
	moon.light_specular = 0.0  # behind cloud: no hard glint; the sky's moonlit patch reflects instead
	moon.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	moon.shadow_bias = 0.05
	add_child(moon)
	moon.basis = Basis.looking_at(-MOON_DIR, Vector3.UP)
	_apply_quality()


func _apply_quality() -> void:
	var e := environment
	var hi := quality == Quality.HIGH
	var f := features(rendering_method, quality)
	e.ssao_enabled = f.ssao
	e.ssao_radius = 1.4
	e.ssao_intensity = 1.8
	e.ssao_power = 1.4
	# SSR / volumetric fog: not touched at all where they do not exist (each setter re-sends its whole group to the
	# server, and the server warns about the group on Compatibility). Both default to off.
	if f.ssr or e.ssr_enabled:
		e.ssr_enabled = f.ssr
	if f.ssr:
		e.ssr_max_steps = 64 if hi else 32
		e.ssr_fade_in = 0.1
		e.ssr_fade_out = 2.0
		e.ssr_depth_tolerance = 0.5
	if f.volumetric_fog or e.volumetric_fog_enabled:
		e.volumetric_fog_enabled = f.volumetric_fog
	if f.volumetric_fog:
		e.volumetric_fog_density = 0.009
		e.volumetric_fog_albedo = Color(0.82, 0.85, 0.9)
		e.volumetric_fog_anisotropy = 0.45
		e.volumetric_fog_length = 96.0 if hi else 64.0
		e.volumetric_fog_ambient_inject = 0.04  # haze comes from the lamps, not a blue veil over long views
		e.volumetric_fog_sky_affect = 0.0
		e.volumetric_fog_temporal_reprojection_enabled = true
		RenderingServer.environment_set_volumetric_fog_volume_size(128 if hi else 64, 96 if hi else 48)
	moon.shadow_enabled = quality >= Quality.MEDIUM
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if hi else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	moon.directional_shadow_max_distance = 140.0 if hi else 80.0
	if _rain != null:
		_rain.emitting = raining and f.rain
		_rain.visible = raining and f.rain
		_rain.amount = 2000 if hi else 1200
	if _ground_mat != null:
		_ground_mat.set_shader_parameter("rain", 1.0 if raining and f.rain else 0.0)


func _grade() -> Texture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.22, 0.6, 1.0])
	g.colors = PackedColorArray([Color(0.0, 0.008, 0.02), Color(0.205, 0.225, 0.24), Color(0.61, 0.6, 0.585), Color(1.0, 0.985, 0.95)])
	var t := GradientTexture1D.new()
	t.gradient = g
	t.width = 256
	return t


func _noise_tex(size: int, freq: float, seed_: int, octaves: int, normal: bool) -> NoiseTexture2D:
	var n := FastNoiseLite.new()
	n.seed = seed_
	n.frequency = freq
	n.fractal_octaves = octaves
	var t := NoiseTexture2D.new()
	t.width = size
	t.height = size
	t.seamless = true
	t.noise = n
	t.generate_mipmaps = true
	if normal:
		t.as_normal_map = true
		t.bump_strength = 6.0
	return t


## Cellular noise: CELL_VALUE = one flat random tone per cell (aggregate stones); DISTANCE2_SUB = ~0 on the cell
## edges (a crack network; `warp` bends the edges so they wander like cracks, not tiles).
func _cell_tex(size: int, freq: float, seed_: int, ret: int, warp: float) -> NoiseTexture2D:
	var n := FastNoiseLite.new()
	n.noise_type = FastNoiseLite.TYPE_CELLULAR
	n.seed = seed_
	n.frequency = freq
	n.fractal_type = FastNoiseLite.FRACTAL_NONE
	n.cellular_distance_function = FastNoiseLite.DISTANCE_EUCLIDEAN
	n.cellular_return_type = ret
	n.cellular_jitter = 0.9
	if warp > 0.0:
		n.domain_warp_enabled = true
		n.domain_warp_type = FastNoiseLite.DOMAIN_WARP_SIMPLEX
		n.domain_warp_amplitude = warp
		n.domain_warp_frequency = freq * 4.0
		n.domain_warp_fractal_type = FastNoiseLite.DOMAIN_WARP_FRACTAL_PROGRESSIVE
		n.domain_warp_fractal_octaves = 3
	var t := NoiseTexture2D.new()
	t.width = size
	t.height = size
	t.seamless = true
	t.noise = n
	t.generate_mipmaps = true
	return t


# ------------------------------------------------------------------------------------------------ surfaces
func _geometry(n: Node) -> Array:
	var out: Array = []
	if n is GeometryInstance3D:
		out.append(n)
	for c in n.find_children("*", "GeometryInstance3D", true, false):
		out.append(c)
	return out


func _ground_material() -> ShaderMaterial:
	if _ground_mat == null:
		_ground_mat = ShaderMaterial.new()
		_ground_mat.resource_name = "look_wet_ground"
		_ground_mat.shader = GROUND_SHADER
		_ground_mat.set_shader_parameter("grain_tex", _noise_tex(512, 0.03, 21, 5, false))
		_ground_mat.set_shader_parameter("agg_tex", _cell_tex(512, 0.11, 27, FastNoiseLite.RETURN_CELL_VALUE, 0.0))
		_ground_mat.set_shader_parameter("crack_tex", _cell_tex(512, 0.01, 39, FastNoiseLite.RETURN_DISTANCE2_SUB, 18.0))
		_ground_mat.set_shader_parameter("puddle_tex", _noise_tex(256, 0.012, 33, 3, false))
		_ground_mat.set_shader_parameter("detail_nrm", _noise_tex(512, 0.08, 45, 3, true))
		_ground_mat.set_shader_parameter("rain", 1.0 if raining and features(rendering_method, quality).rain else 0.0)
	return _ground_mat


## The ditches: dark, still water (G-WORLD's "mud" tint read as brown paint at night): a near-black body with a mirror
## surface, so it carries the sky, the lamps and (Forward+) SSR.
func _water_material() -> StandardMaterial3D:
	if _water_mat == null:
		_water_mat = StandardMaterial3D.new()
		_water_mat.resource_name = "look_water"
		_water_mat.albedo_color = Color(0.02, 0.022, 0.025, 0.92)
		_water_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_water_mat.roughness = 0.04
		_water_mat.metallic_specular = 0.5
	return _water_mat


func _wet_instance(g: GeometryInstance3D, grp: String) -> void:
	if g.material_override != null:
		g.material_override = _wet_of(g.material_override, grp, _has_uv2(g, 0))
		return
	if g is MeshInstance3D and g.mesh != null:
		var mi := g as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var src := mi.get_surface_override_material(i)
			if src == null:
				src = mi.mesh.surface_get_material(i)
			if src != null:
				mi.set_surface_override_material(i, _wet_of(src, grp, _has_uv2(g, i)))
	elif g is MultiMeshInstance3D and g.multimesh != null and g.multimesh.mesh != null:
		var mesh: Mesh = g.multimesh.mesh  # the piece's own mesh (one per MultiMesh): wetting it in place is safe
		for i in mesh.get_surface_count():
			var src := mesh.surface_get_material(i)
			if src != null:
				mesh.surface_set_material(i, _wet_of(src, grp, _has_uv2(g, i)))


func _has_uv2(g: GeometryInstance3D, surface: int) -> bool:
	var mesh: Mesh = g.mesh if g is MeshInstance3D else (g.multimesh.mesh if g is MultiMeshInstance3D and g.multimesh else null)
	if mesh == null or surface >= mesh.get_surface_count() or not (mesh is ArrayMesh):
		return false
	return (mesh as ArrayMesh).surface_get_format(surface) & Mesh.ARRAY_FORMAT_TEX_UV2 != 0


## A wet version of a material, cached per source (shared sources stay shared, so batching is kept). The maps are
## never replaced: textured kit materials move onto kit_wet.gdshader with the same textures (plus the paint mask);
## G-WORLD's vertex-coloured prims onto prims_wet.gdshader (its UV2 roughness / metallic); any other BaseMaterial3D
## is duplicated darker and smoother; a ShaderMaterial is wetted only if it exposes a `wetness` uniform.
func _wet_of(m: Material, grp := "", uv2 := false) -> Material:
	if m == null or m.has_meta("look_wet"):
		return m
	var key := [m, grp, uv2]
	if _wet.has(key):
		return _wet[key]
	var w: Material = m
	var clearcoat := 0.35 if _forward_plus and quality == Quality.HIGH else 0.0
	if m is BaseMaterial3D and grp == "kit" and (m as BaseMaterial3D).albedo_texture != null:
		var b := m as BaseMaterial3D
		var sm := ShaderMaterial.new()
		sm.shader = KIT_SHADER
		sm.resource_name = "look_wet_" + b.resource_name
		sm.set_shader_parameter("albedo_tex", b.albedo_texture)
		sm.set_shader_parameter("albedo_color", b.albedo_color)
		sm.set_shader_parameter("paint_tint", b.vertex_color_use_as_albedo)
		var orm := b.roughness_texture if b.roughness_texture != null else b.metallic_texture
		sm.set_shader_parameter("has_orm", orm != null)
		if orm != null:
			sm.set_shader_parameter("orm_tex", orm)
		sm.set_shader_parameter("has_normal", b.normal_enabled and b.normal_texture != null)
		if b.normal_texture != null:
			sm.set_shader_parameter("normal_tex", b.normal_texture)
		sm.set_shader_parameter("metallic_scale", b.metallic)
		sm.set_shader_parameter("roughness_scale", b.roughness)
		sm.set_shader_parameter("wet_darken", WET_DARKEN)
		sm.set_shader_parameter("wet_rough", WET_ROUGH)
		sm.set_shader_parameter("clearcoat_amount", clearcoat)
		sm.set_shader_parameter("streak_tex", _streak_tex())
		sm.set_meta("look_src", b)
		w = sm
	elif m is BaseMaterial3D and grp == "prims" and uv2 and (m as BaseMaterial3D).vertex_color_use_as_albedo:
		var sm := ShaderMaterial.new()
		sm.shader = PRIMS_SHADER
		sm.resource_name = "look_wet_prims"
		sm.set_shader_parameter("base_color", (m as BaseMaterial3D).albedo_color)
		sm.set_shader_parameter("grime_tex", _streak_tex())
		sm.set_shader_parameter("wet_darken", WET_DARKEN)
		sm.set_shader_parameter("wet_rough", WET_ROUGH)
		w = sm
	elif m is BaseMaterial3D:
		var b := (m as BaseMaterial3D).duplicate() as BaseMaterial3D
		var c := b.albedo_color
		b.albedo_color = Color(c.r * WET_DARKEN, c.g * WET_DARKEN, c.b * WET_DARKEN, c.a)
		b.roughness = b.roughness * WET_ROUGH
		if clearcoat > 0.0:
			b.clearcoat_enabled = true
			b.clearcoat = clearcoat
			b.clearcoat_roughness = 0.2
		w = b
	elif m is ShaderMaterial and m.shader != null and _has_uniform(m.shader, "wetness"):
		w = m.duplicate()
		(w as ShaderMaterial).set_shader_parameter("wetness", 1.0)
	else:
		return m
	w.set_meta("look_wet", true)
	_wet[key] = w
	return w


func _streak_tex() -> NoiseTexture2D:
	if _streaks == null:
		_streaks = _noise_tex(256, 0.02, 57, 4, false)
	return _streaks


func _has_uniform(s: Shader, uname: String) -> bool:
	for u in s.get_shader_uniform_list():
		if u.name == uname:
			return true
	return false


## The FloodLamp kit piece has one material; its lens is the cream panel of the atlas. Emission = the albedo where
## it is cream (warm, bright, not grey), tinted sodium, strong enough to cross the glow threshold.
func _lamp_lenses() -> void:
	for n in get_tree().get_nodes_in_group("kit"):
		if not String(n.name).contains("FloodLamp") and n.find_children("*FloodLamp*", "", true, false).is_empty():
			continue
		for g in _geometry(n):
			if g is MeshInstance3D and g.mesh != null:
				var mi := g as MeshInstance3D
				for i in mi.mesh.get_surface_count():
					var src := mi.get_surface_override_material(i)
					if src == null:
						src = mi.mesh.surface_get_material(i)
					var lens := _lens_of(src)
					if lens != null:
						mi.set_surface_override_material(i, lens)
			elif g is MultiMeshInstance3D and g.multimesh != null and g.multimesh.mesh != null:
				var mesh: Mesh = g.multimesh.mesh
				for i in mesh.get_surface_count():
					var lens := _lens_of(mesh.surface_get_material(i))
					if lens != null:
						mesh.surface_set_material(i, lens)


func _lens_of(src: Material) -> Material:
	if src == null or src.has_meta("look_lens"):
		return null
	if _lens.has(src):
		return _lens[src]
	_lens[src] = null
	var base: BaseMaterial3D = src.get_meta("look_src") if src.has_meta("look_src") else (src as BaseMaterial3D)
	if base == null or base.albedo_texture == null:
		return null
	var img := base.albedo_texture.get_image()
	if img == null:
		return null
	img = img.duplicate()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGB8)
	img.resize(256, 256, Image.INTERPOLATE_BILINEAR)
	var mask := Image.create(256, 256, false, Image.FORMAT_RGB8)
	var hits := 0
	for y in 256:
		for x in 256:
			var c := img.get_pixel(x, y)
			if c.r > 0.45 and c.g > 0.4 and c.r - c.b > 0.08:
				mask.set_pixel(x, y, c)
				hits += 1
	if hits < 256 * 256 / 200:  # no lens-like panel: leave the piece alone
		return null
	mask.generate_mipmaps()
	var wet := _wet_of(src, "kit")
	var l: Material = wet.duplicate()
	if l is ShaderMaterial:
		l.set_shader_parameter("emission_tex", ImageTexture.create_from_image(mask))
		l.set_shader_parameter("emission_color", SODIUM)
		l.set_shader_parameter("emission_energy", LENS_ENERGY)
	else:
		var b := l as BaseMaterial3D
		b.emission_enabled = true
		b.emission = SODIUM
		b.emission_texture = ImageTexture.create_from_image(mask)
		b.emission_energy_multiplier = LENS_ENERGY
	l.set_meta("look_wet", true)
	l.set_meta("look_lens", true)
	_lens[src] = l
	return l


# ------------------------------------------------------------------------------------------------ lights
func _build_floods() -> void:
	if _flood_root != null:
		_flood_root.free()
	floods.clear()
	_flood_root = Node3D.new()
	_flood_root.name = "Floods"
	add_child(_flood_root)
	if _world == null or not _world.has_method("floodlights"):
		return
	var list: Array = _world.floodlights()
	var shadows: int = features(rendering_method, quality).flood_shadows
	var stride := maxi(1, ceili(float(list.size()) / maxf(1.0, float(shadows))))
	var shadowed := 0
	for i in list.size():
		var e: Dictionary = list[i]
		var pos: Vector3 = e.get("pos", Vector3.ZERO)
		var tgt: Vector3 = e.get("target", pos + Vector3.DOWN)
		var s := SpotLight3D.new()
		s.name = "Flood%d" % i
		s.light_color = SODIUM
		s.light_energy = FLOOD_ENERGY
		s.light_indirect_energy = 0.5
		s.light_volumetric_fog_energy = 0.4  # a halo in the haze, not an orange dust storm at play height
		s.light_specular = 1.0
		s.spot_range = clampf(pos.distance_to(tgt) * 2.0, 30.0, 90.0)
		# a pool, not a floodlit field: a narrower cone, a flat-topped hot centre and a defined edge (the W12 42-degree
		# soft cone lit the whole pit evenly, so no pool read from the play cameras)
		s.spot_angle = 32.0
		s.spot_angle_attenuation = 1.6
		s.spot_attenuation = 0.9
		s.shadow_enabled = shadowed < shadows and i % stride == 0
		if s.shadow_enabled:
			shadowed += 1
		s.shadow_bias = 0.06
		_flood_root.add_child(s)
		s.global_position = pos
		if not pos.is_equal_approx(tgt):
			s.look_at(tgt, Vector3.UP if absf((tgt - pos).normalized().y) < 0.99 else Vector3.FORWARD)
		floods.append(s)


## Warm practicals: the Lot's own lamp list (World.lamps() if it exists, else World.data.lamps: rows
## [x, y, z, size, yaw, kind]). `lampTube` = a glowing tube (one MultiMesh) plus a small shadowless warm light when it
## is on the play space; `laserRed` = the crane's red beacons (emissive only). `sodium` rows are the flood heads, lit by
## the FloodLamp lens and the SpotLights above.
func _lamp_rows() -> Array:
	if _world == null:
		return []
	if _world.has_method("lamps"):
		return _world.lamps()
	var d = _world.get("data")
	return d.get("lamps", []) if d is Dictionary else []


func _build_practicals() -> void:
	if _practical_root != null:
		_practical_root.free()
	_practical_root = Node3D.new()
	_practical_root.name = "Practicals"
	add_child(_practical_root)
	var kinds := {"lampTube": [Color(1.0, 0.8, 0.55), Vector3(0.12, 0.1, 1.0), 5.0], "laserRed": [Color(1.0, 0.08, 0.05), Vector3(0.5, 0.5, 0.5), 8.0]}
	for kind in kinds:
		var rows := []
		for r in _lamp_rows():
			if r is Array and r.size() >= 6 and r[5] == kind:
				rows.append(r)
		if rows.is_empty():
			continue
		var spec: Array = kinds[kind]
		var box := BoxMesh.new()
		box.size = spec[1]
		var m := StandardMaterial3D.new()
		m.albedo_color = Color.BLACK
		m.emission_enabled = true
		m.emission = spec[0]
		m.emission_energy_multiplier = spec[2]
		box.material = m
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = box
		mm.instance_count = rows.size()
		for i in rows.size():
			var r: Array = rows[i]
			var b := Basis(Vector3.UP, float(r[4])).scaled(Vector3(1, 1, float(r[3])) if kind == "lampTube" else Vector3.ONE * float(r[3]))
			mm.set_instance_transform(i, Transform3D(b, Vector3(r[0], r[1], r[2])))
			if kind == "lampTube" and float(r[1]) < 30.0 and quality >= Quality.MEDIUM:
				var o := OmniLight3D.new()
				o.light_color = spec[0]
				o.light_energy = 2.0
				o.omni_range = 9.0
				o.omni_attenuation = 1.2
				o.light_volumetric_fog_energy = 0.5
				_practical_root.add_child(o)
				o.global_position = Vector3(r[0], float(r[1]) - 0.4, r[2])
		var mmi := MultiMeshInstance3D.new()
		mmi.name = kind
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_practical_root.add_child(mmi)


# ------------------------------------------------------------------------------------------------ rain
func _build_rain() -> void:
	_rain = GPUParticles3D.new()
	_rain.name = "Rain"
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(16, 9, 16)
	pm.direction = Vector3(0.08, -1, 0.03)
	pm.spread = 2.0
	pm.initial_velocity_min = 17.0
	pm.initial_velocity_max = 21.0
	pm.gravity = Vector3.ZERO
	_rain.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.01, 0.4)
	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rm.albedo_color = Color(0.6, 0.65, 0.72, 0.09)
	rm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	rm.billboard_keep_scale = true
	rm.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_ALPHA  # no fat streaks on the lens
	rm.distance_fade_min_distance = 1.0
	rm.distance_fade_max_distance = 4.0
	q.material = rm
	_rain.draw_pass_1 = q
	_rain.lifetime = 0.9
	_rain.local_coords = false
	_rain.visibility_aabb = AABB(Vector3(-20, -25, -20), Vector3(40, 40, 40))
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_rain)
	_apply_quality()


func _process(_d: float) -> void:
	_n += 1
	if _rain != null and _rain.emitting:
		var cam := get_viewport().get_camera_3d()
		if cam != null:
			_rain.global_position = cam.global_position - cam.global_basis.z * 8.0 + Vector3(0, 8, 0)
	if _stats:
		_stat_tick()


# ------------------------------------------------------------------------------------------------ A/B + stats
func _skeleton_look() -> void:
	# the Wave 12 skeleton's look, kept for the A/B (`--look off`)
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


func _stat_tick() -> void:
	# Proof's --cam camera goes live 5 frames before the shot: measure the 3 frames after it.
	var f := _stat_frames
	if _n == f - 4:
		_t0 = Time.get_ticks_usec()
	elif _n == f - 1:
		var ms := float(Time.get_ticks_usec() - _t0) / 3000.0
		print("LOOK stats look=%s quality=%s renderer=%s draws=%d objects=%d primitives=%d frame_ms=%.1f floods=%d" % [
			"on" if enabled else "off", ["low", "medium", "high"][quality], RenderingServer.get_current_rendering_method(),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
			ms, floods.size()])

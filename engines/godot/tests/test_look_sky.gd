extends RefCounted
## G-ATMOS (W17 AAA pass 1, G-SKY): the night sky is the shared sky SOURCE, assets/sky/lot_night_sky.exr, a Blender
## panorama Godot and the web twin both sample, with its receipt (lot_night_sky.receipt.json).
## Headless (CI):
## 1. The SOURCE loads from the shared path (repo assets/, never a copy under engines/godot): 2048 x 1024, stored as
##    shared-exponent RGBE9995 (4 bytes a texel).
## 2. The sky material per renderer: the SOURCE on, encode_srgb on Compatibility only (its sky shader writes COLOR
##    without sRGB encoding), the display and light energies, the receipt's horizon and zenith.
## 3. Fog = the horizon = the receipt: the fog colour is the receipt's horizon (its linear mean, sRGB-encoded), shown
##    at the sky's display energy, and the sky's below-horizon haze uses the same colour.
## 4. The SOURCE's radiance at the horizon and zenith sample directions (through SKY_COORDS: u = atan2(x, -z) / 2pi,
##    v = acos(y) / pi) matches the receipt's means within SKY_TOL.
## 5. A missing SOURCE is a clear error naming the path, never silent: look.gd logs it (sky_error) and falls back, as
##    documented, to a plain gradient between the receipt's horizon and zenith.
## With a renderer (`xvfb-run -a godot --path engines/godot [--rendering-method ...] --script res://tests/run.gd --
## --only look_sky`): the axes. A marker panorama in the SOURCE's convention (red -Z, green +X, blue +Z, yellow -X,
## white +Y; SKY_MARKERS=<exr> uses BL-DCC's markers EXR instead of the built one) is drawn as the sky, and the camera
## looking down each axis must see that axis's colour at the screen centre.
## The ruled energies (a re-tune is a ruling: change it here and in G-ATMOS.md § G-SKY together). SKY_ENERGY 0.60:
## the W17 G-SKY ruling on v3 (the corgi-rim bags' 30 m edge); SKY_LIGHT_ENERGY 0.12: the probe-sphere calibration.
const RULED_SKY_ENERGY := 0.60
const RULED_SKY_LIGHT_ENERGY := 0.12
const SKY_TOL := 0.01        # relative: RGBE9995 keeps 9 mantissa bits (<= 0.4 % a texel); the row means are better
const W := 2048
const H := 1024
const MARKERS := [["-Z", Vector3(0, 0, -1), Color(1, 0, 0)], ["+X", Vector3(1, 0, 0), Color(0, 1, 0)],
	["+Z", Vector3(0, 0, 1), Color(0, 0, 1)], ["-X", Vector3(-1, 0, 0), Color(1, 1, 0)], ["+Y", Vector3(0, 1, 0), Color(1, 1, 1)]]


func run(tree: SceneTree) -> Array:
	var errs: Array = []
	var Look = load("res://look/look.gd")
	var root := ProjectSettings.globalize_path("res://").path_join("../..")
	var exr_path: String = root.path_join(Look.SKY_SOURCE).simplify_path()
	var receipt_path: String = root.path_join(Look.SKY_RECEIPT).simplify_path()
	var res_dir := ProjectSettings.globalize_path("res://").simplify_path()

	# 1. the SOURCE, from the shared path
	if exr_path.begins_with(res_dir) or not exr_path.ends_with("assets/sky/lot_night_sky.exr"):
		errs.append("the sky SOURCE path %s is not the shared repo asset assets/sky/lot_night_sky.exr" % exr_path)
	if FileAccess.file_exists("res://look/lot_night_sky.exr") or FileAccess.file_exists("res://lot_night_sky.exr") \
			or FileAccess.file_exists("res://assets/sky/lot_night_sky.exr"):
		errs.append("a copy of the sky SOURCE sits under engines/godot (one source, no copies)")
	var src: Dictionary = Look.load_sky_source(exr_path)
	var img: Image = src.image
	if img == null:
		errs.append("the sky SOURCE did not load: %s" % src.error)
		return errs
	if img.get_width() != W or img.get_height() != H or img.get_format() != Image.FORMAT_RGBE9995:
		errs.append("the sky SOURCE is %dx%d format %d; want %dx%d RGBE9995" % [img.get_width(), img.get_height(), img.get_format(), W, H])

	# the receipt
	var rc: Dictionary = Look.read_sky_receipt(receipt_path)
	if rc.error != "":
		errs.append(rc.error)
		return errs
	var rj: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(receipt_path))
	var hl := _v(rj.sky.horizon_linear)
	var zl := _v(rj.sky.zenith_linear)

	# the ruled energies: the material checks below compare against Look's constants, so pin the constants themselves
	if not is_equal_approx(float(Look.SKY_ENERGY), RULED_SKY_ENERGY) or not is_equal_approx(float(Look.SKY_LIGHT_ENERGY), RULED_SKY_LIGHT_ENERGY):
		errs.append("SKY_ENERGY %s / SKY_LIGHT_ENERGY %s moved off the ruled %s / %s (a re-tune needs the ruling and the full cover bar)" % [
			Look.SKY_ENERGY, Look.SKY_LIGHT_ENERGY, RULED_SKY_ENERGY, RULED_SKY_LIGHT_ENERGY])
	# 2 and 3. the sky material per renderer, and fog = horizon = the receipt
	for method in ["forward_plus", "mobile", "gl_compatibility"]:
		var look: Node = Look.new()
		look.rendering_method = method
		tree.root.add_child(look)
		await tree.process_frame
		var m: ShaderMaterial = look.environment.sky.sky_material
		var e: Environment = look.environment
		if look.sky_error != "":
			errs.append("%s: %s" % [method, look.sky_error])
		if m.get_shader_parameter("use_source") != true:
			errs.append("%s: the sky does not draw the SOURCE" % method)
		var tex = m.get_shader_parameter("source_panorama")
		if not (tex is Texture2D and tex.get_width() == W and tex.get_height() == H):
			errs.append("%s: source_panorama is %s, not the %dx%d SOURCE" % [method, tex, W, H])
		if m.get_shader_parameter("encode_srgb") != (method == "gl_compatibility"):
			errs.append("%s: encode_srgb %s (want it on Compatibility only)" % [method, m.get_shader_parameter("encode_srgb")])
		if not is_equal_approx(float(m.get_shader_parameter("energy")), float(Look.SKY_ENERGY)) \
				or not is_equal_approx(float(m.get_shader_parameter("light_energy")), float(Look.SKY_LIGHT_ENERGY)):
			errs.append("%s: sky energy %s / light %s, want SKY_ENERGY %s / SKY_LIGHT_ENERGY %s" % [method,
				m.get_shader_parameter("energy"), m.get_shader_parameter("light_energy"), Look.SKY_ENERGY, Look.SKY_LIGHT_ENERGY])
		var fog := e.fog_light_color
		if not _close(_v3(fog.srgb_to_linear()), hl, 1e-4):
			errs.append("%s: fog colour %s (linear %s) is not the receipt's horizon %s" % [method, fog, fog.srgb_to_linear(), hl])
		if not is_equal_approx(e.fog_light_energy, float(Look.SKY_ENERGY)):
			errs.append("%s: the fog shows at %s, the sky at SKY_ENERGY %s" % [method, e.fog_light_energy, Look.SKY_ENERGY])
		if m.get_shader_parameter("horizon_color") != fog or look.SKY_HORIZON != fog:
			errs.append("%s: the sky's horizon %s / SKY_HORIZON %s is not the fog colour %s" % [method,
				m.get_shader_parameter("horizon_color"), look.SKY_HORIZON, fog])
		if not _close(_v3(look.SKY_ZENITH.srgb_to_linear()), zl, 1e-4) or m.get_shader_parameter("zenith_color") != look.SKY_ZENITH:
			errs.append("%s: SKY_ZENITH %s is not the receipt's zenith %s" % [method, look.SKY_ZENITH, zl])
		look.queue_free()
		await tree.process_frame

	# 4. the radiance at the horizon and zenith sample directions, through SKY_COORDS
	var hor := Vector3.ZERO
	var zen := Vector3.ZERO
	for i in W:
		var az := (i + 0.5) / W * TAU
		for el in [asin(cos(PI * 511.5 / H)), asin(cos(PI * 512.5 / H))]:  # the elevations of rows 511 and 512
			hor += _sample(img, Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el))) / (2.0 * W)
		for el in [asin(cos(PI * 0.5 / H)), asin(cos(PI * 1.5 / H))]:      # rows 0 and 1
			zen += _sample(img, Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el))) / (2.0 * W)
	if not _close(hor, hl, SKY_TOL * hl.length()):
		errs.append("the SOURCE's horizon radiance %s is not the receipt's %s (within %.0f %%)" % [hor, hl, SKY_TOL * 100.0])
	if not _close(zen, zl, SKY_TOL * zl.length()):
		errs.append("the SOURCE's zenith radiance %s is not the receipt's %s (within %.0f %%)" % [zen, zl, SKY_TOL * 100.0])

	# 5. a missing SOURCE: a clear error, and the documented fallback
	var miss: Dictionary = Look.load_sky_source(root.path_join("assets/sky/missing_sky.exr").simplify_path())
	if miss.image != null or not "missing_sky.exr" in str(miss.error) or not "missing" in str(miss.error):
		errs.append("a missing SOURCE is not a clear error: %s" % miss.error)
	var fb: Node = Look.new()
	fb.sky_source = "assets/sky/missing_sky.exr"
	fb.sky_quiet = true  # this miss is deliberate: kept out of the error log, still reported in sky_error
	tree.root.add_child(fb)
	await tree.process_frame
	var fm: ShaderMaterial = fb.environment.sky.sky_material
	if not "missing_sky.exr" in fb.sky_error or fm.get_shader_parameter("use_source") != false \
			or fm.get_shader_parameter("horizon_color") != fb.environment.fog_light_color \
			or not _close(_v3(fb.SKY_HORIZON.srgb_to_linear()), hl, 1e-4):
		errs.append("no SOURCE: want sky_error naming the file, the gradient (use_source off) and the receipt's horizon as fog; got '%s', use_source %s" % [
			fb.sky_error, fm.get_shader_parameter("use_source")])
	fb.queue_free()
	await tree.process_frame

	# with a renderer: the axes, drawn
	if DisplayServer.get_name() != "headless":
		errs.append_array(await _axes(tree, Look))
	else:
		print("  (headless: the axes are drawn with a renderer; run under xvfb to check them)")
	return errs


## The SOURCE's convention, as the sky shader samples it: SKY_COORDS = (atan2(x, -z) / 2pi, acos(y) / pi).
static func _uv(d: Vector3) -> Vector2:
	return Vector2(fposmod(atan2(d.x, -d.z) / TAU, 1.0), acos(clampf(d.y, -1.0, 1.0)) / PI)


static func _sample(img: Image, d: Vector3) -> Vector3:
	var uv := _uv(d.normalized())
	var c := img.get_pixel(clampi(int(uv.x * img.get_width()), 0, img.get_width() - 1), clampi(int(uv.y * img.get_height()), 0, img.get_height() - 1))
	return Vector3(c.r, c.g, c.b)


static func _v(a) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


static func _v3(c: Color) -> Vector3:
	return Vector3(c.r, c.g, c.b)


static func _close(a: Vector3, b: Vector3, tol: float) -> bool:
	return (a - b).abs().x <= tol and (a - b).abs().y <= tol and (a - b).abs().z <= tol


## Which marker a displayed colour is: white if grey and bright, else the nearest marker hue (the tonemap greys and
## shifts the markers' pure colours, so a channel test would not do).
static func _marker_of(c: Color) -> String:
	if c.v < 0.3:
		return "dark"
	if c.s < 0.2:
		return "+Y"
	var best := ""
	var bd := 2.0
	for mrk in MARKERS:
		var mc: Color = mrk[2]
		if mc.s < 0.2:
			continue
		var dh := absf(fposmod(c.h - mc.h + 0.5, 1.0) - 0.5)
		if dh < bd:
			bd = dh
			best = mrk[0]
	return best


## Draws a marker panorama as the sky and looks down each axis.
func _axes(tree: SceneTree, Look) -> Array:
	var errs: Array = []
	var mk: Image
	var custom := OS.get_environment("SKY_MARKERS")
	if custom != "":
		mk = Image.load_from_file(custom)
	else:
		mk = Image.create(256, 128, false, Image.FORMAT_RGBH)
		for y in 128:
			for x in 256:
				var d := Vector3.ZERO
				var u := (x + 0.5) / 256.0
				var v := (y + 0.5) / 128.0
				d = Vector3(sin(u * TAU) * sin(v * PI), cos(v * PI), -cos(u * TAU) * sin(v * PI))
				var c := Color(0, 0, 0)
				for mrk in MARKERS:
					if d.dot(mrk[1]) > cos(deg_to_rad(9.0)):
						c = mrk[2]
				mk.set_pixel(x, y, c)
	print("  sky axes: markers %s (%dx%d)" % [custom if custom != "" else "built in the test", mk.get_width(), mk.get_height()])
	var look: Node = Look.new()
	look.raining = false
	tree.root.add_child(look)
	var cam := Camera3D.new()
	cam.fov = 30.0
	tree.root.add_child(cam)
	cam.current = true
	await tree.process_frame
	var m: ShaderMaterial = look.environment.sky.sky_material
	m.set_shader_parameter("source_panorama", ImageTexture.create_from_image(mk))
	m.set_shader_parameter("energy", 1.0)
	look.environment.fog_enabled = false
	look.environment.adjustment_enabled = false
	for mrk in MARKERS:
		var d: Vector3 = mrk[1]
		cam.global_position = Vector3.ZERO
		cam.look_at(d * 10.0, Vector3.BACK if absf(d.y) > 0.9 else Vector3.UP)
		for i in 4:
			await RenderingServer.frame_post_draw
		var img := tree.root.get_texture().get_image()
		var c := img.get_pixel(img.get_width() / 2, img.get_height() / 2)
		var want: Color = mrk[2]
		var ok: bool = _marker_of(c) == str(mrk[0])
		print("  sky axis %s: centre %s, reads as %s" % [mrk[0], c, _marker_of(c)])
		if not ok:
			errs.append("the sky's %s is not where SKY_COORDS puts it: the centre looking down %s is %s, want %s" % [mrk[0], mrk[0], c, want])
	cam.queue_free()
	look.queue_free()
	await tree.process_frame
	return errs

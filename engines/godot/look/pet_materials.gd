extends RefCounted
## Pet materials for G-GAME (through Look.pet_material): `coat` (wet fur sheen; corgi warm ochre/tan, cat cool grey
## tabby), `accent` (corgi white chest, muzzle and socks; cat pale muzzle and chest), `dark` (eyes, nose), `band` (the
## team band: harness straps around the torso and the collar), `plate` (scuffed ochre armour with a team band),
## `metal` (rifle metal).
## One cached material per (kind, species, team), so every pet of a side shares it. Object-space triplanar mapping:
## any placeholder or final mesh works without UVs. species: 0 corgi, 1 cat. team: 0 Corgi Company, 1 Cat Cadre (the
## locked team signal colours of the web game's PALETTE.teamCorgis / teamCats).
## Readability at 30 m at night (W13 R-PETS): coat colour separates species (warm ochre vs neutral grey); the team band
## (the team paint on the armour, `band`) separates sides by hue AND by lightness (the two locked hues are within 1.1:1
## of each other in luminance, so hue alone is not enough). Each band contrasts with its own coat in lightness, in
## opposite directions: Corgi Company a light, saturated blue on the mid-tone tan corgi; Cat Cadre a dark crimson on the
## light grey cat. Both keep the locked hue. W14 TEAM (Q-READ2: the W13 near-white blue rendered white, C* 3-8): the
## blue is saturated and its self-lit level sits below the tonemapper's shoulder, so it stays a nameable blue on screen.
## Every emissive here stays below the look's glow threshold (glow_hdr_threshold 1.3 at exposure 1.25): the bands are
## self-lit so they survive the dark and the fog, but they do not bloom.
const KINDS := ["coat", "accent", "dark", "band", "plate", "metal"]
const TEAM := [Color("2f6fd6"), Color("c9344a")]
## The team band colours: Corgi Company the locked blue itself (2f6fd6, C* 61), Cat Cadre a dark crimson (c9344a
## darkened 0.45). Measured through the look (AgX, grade, fog) on side-on corgis 30 m from a play-height camera,
## Compatibility: the W13 near-white blue rendered L* 73 C* 7 (white); 2f6fd6 at 1.0 renders L* 58 C* 33 and at 1.3
## L* 70 C* 27, against the corgi coat at L* 38. The crimson at 1.4 rendered L* 39 against the cat coat at L* 44-50,
## at 0.9 L* 21 C* 37.
const BAND := [Color(0.1843, 0.4353, 0.8392), Color(0.4335, 0.1122, 0.1596)]
## Self-lit. The Corgi blue at 1.15 peaks at 0.97 after exposure: under the glow threshold and short of the tonemap
## shoulder that turned the W13 blue white (at 1.25 chroma fell to C* 28), and lighter than the tan corgi on screen.
## The Cat crimson at 1.0 stays darker than the grey cat and still red (rendered L* 24-25, C* 31-41).
const BAND_ENERGY := [1.15, 1.0]
const OCHRE := Color(0.74, 0.53, 0.16)
const CORGI_COAT := Color(0.7, 0.43, 0.22)  # W14: a touch deeper (was 0.72, 0.46, 0.26), under the Corgi blue
## W13 R-PETS2: a light neutral grey tabby, a hair warm (was 0.64, 0.66, 0.71: under the blue night ambient its shaded
## side read blue, Corgi Company's hue). Light enough that the cat is not the harder pet to see, and that the dark Cat
## Cadre band stands out on it.
const CAT_COAT := Color(0.67, 0.66, 0.64)
const ACCENT := [Color(0.95, 0.91, 0.84), Color(0.85, 0.84, 0.82)]  # corgi white bib / cat pale muzzle
const DARK := Color(0.05, 0.045, 0.045)
## The self-lit fill on fur (W12 Q6 P1): away from the floods a pet was a black silhouette. W13: the fill is now the
## coat's own colour times the fur texture (EMISSION_OP_MULTIPLY). At W12 it was 0.28 x (colour + fur texture), the
## default ADD operator, which put a grey wash over both coats (corgi and cat drifted toward the same pale grey).
## Per species: the striped grey cat needs more fill than the saturated ochre corgi to be as easy to see. W14: the
## corgi's 0.6 (was 0.7) leaves room for the Corgi Company blue to sit clearly above it.
const FUR_FILL := [0.6, 0.9]

var _cache := {}
var _tex := {}
var forward_plus := true  # clearcoat (the wet film) only where the renderer has it


func get_material(kind: String, species: int, team: int) -> Material:
	species = clampi(species, 0, 1)
	team = clampi(team, 0, 1)
	if kind in ["band", "plate"]:
		species = 0  # the side's colours: one material per team, shared by both species
	elif kind in ["dark", "metal"]:
		species = 0
		team = 0
	var key := "%s_%d_%d" % [kind, species, team]
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.resource_name = "look_pet_" + key
	m.uv1_triplanar = true
	m.uv1_world_triplanar = false
	match kind:
		"coat", "accent":
			var c: Color = (CORGI_COAT if species == 0 else CAT_COAT) if kind == "coat" else ACCENT[species]
			m.albedo_color = c
			m.albedo_texture = _fur(species)
			m.uv1_scale = Vector3(2.5, 2.5, 2.5)
			m.roughness = 0.42 if kind == "coat" else 0.5  # wet fur: tight highlights
			m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
			m.rim_enabled = true      # the sheen along the silhouette that sells a wet coat
			m.rim = 0.55
			m.rim_tint = 0.35
			# W12 Q6 P1: a character-only readability fill (the web's P4 lesson: readability at range is lighting). A
			# faint self-lit coat keeps species colour and shape readable at 30 m, well below the glow threshold.
			m.emission_enabled = true
			m.emission = c
			m.emission_texture = _fur(species)
			m.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
			m.emission_energy_multiplier = FUR_FILL[species]
		"dark":
			m.albedo_color = DARK
			m.roughness = 0.25  # wet eyes and nose
		"band":
			# the team paint on the armour: self-lit so the side reads at 30 m in the dark and the fog, no glow. Matte
			# (W14: no clearcoat), so a white sheen does not wash the colour out on screen.
			m.albedo_color = BAND[team]
			m.albedo_texture = _wear()
			m.uv1_scale = Vector3(3, 3, 3)
			m.roughness = 0.6
			m.emission_enabled = true
			m.emission = BAND[team]
			m.emission_energy_multiplier = BAND_ENERGY[team]
		"plate":
			m.albedo_texture = _plate(team)
			m.uv1_scale = Vector3(1.4, 1.4, 1.4)
			m.roughness = 0.38
			m.metallic = 0.1
			# the plate's band is self-lit (below the glow threshold), in the same team band colour. MULTIPLY: the mask
			# masks. At W12 the default ADD made the emission band + mask, white over the band (above the glow threshold)
			# and band-coloured over the ochre, so the plate read as a pale glowing block on both sides.
			m.emission_enabled = true
			m.emission = BAND[team]
			m.emission_energy_multiplier = BAND_ENERGY[team]
			m.emission_texture = _band_mask()
			m.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
			if forward_plus:
				m.clearcoat_enabled = true
				m.clearcoat = 0.6
				m.clearcoat_roughness = 0.12
		"metal":
			m.albedo_color = Color(0.23, 0.23, 0.24)
			m.albedo_texture = _wear()
			m.uv1_scale = Vector3(3, 3, 3)
			m.metallic = 0.9
			m.roughness = 0.32
		_:
			push_warning("Look.pet_material: unknown kind '%s' (want one of %s)" % [kind, ", ".join(KINDS)])
			m.albedo_color = Color(0.4, 0.4, 0.4)
	_cache[key] = m
	return m


func _noise(freq: float, seed_: int) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = seed_
	n.frequency = freq
	n.fractal_octaves = 4
	return n


## Fur: vertical strands (corgi: tan with a lighter wash; cat: tabby bands with a wobble).
func _fur(species: int) -> Texture2D:
	var k := "fur%d" % species
	if _tex.has(k):
		return _tex[k]
	var img := Image.create(128, 128, false, Image.FORMAT_RGB8)
	var n := _noise(0.05, 11 + species)
	for y in 128:
		for x in 128:
			var strand := 0.85 + 0.15 * n.get_noise_2d(x * 3.0, y * 0.25)
			var v := strand
			if species == 1:
				var band := sin(y * 0.2 + n.get_noise_2d(x, y) * 4.0)
				v *= lerpf(1.0, 0.55, smoothstep(0.2, 0.7, band))
			else:
				v *= lerpf(1.0, 1.25, smoothstep(0.1, 0.6, n.get_noise_2d(x * 0.5, y * 0.5 + 40.0)))
			img.set_pixel(x, y, Color(v, v, v).clamp())
	img.generate_mipmaps()
	_tex[k] = ImageTexture.create_from_image(img)
	return _tex[k]


## Plate: ochre paint, a team band across the top third, dark grime blotches and bare-metal scuffs over both.
func _plate(team: int) -> Texture2D:
	var k := "plate%d" % team
	if _tex.has(k):
		return _tex[k]
	var img := Image.create(128, 128, false, Image.FORMAT_RGB8)
	var grime := _noise(0.045, 5)
	var scuff := _noise(0.16, 9)
	for y in 128:
		for x in 128:
			var c: Color = BAND[team] if y < 44 else OCHRE
			var gv := grime.get_noise_2d(x, y)
			c = c.lerp(Color(0.07, 0.075, 0.09), smoothstep(0.18, 0.3, gv) * 0.85)
			if scuff.get_noise_2d(x, y) > 0.42:
				c = Color(0.3, 0.29, 0.27)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	_tex[k] = ImageTexture.create_from_image(img)
	return _tex[k]


func _band_mask() -> Texture2D:
	if _tex.has("band"):
		return _tex["band"]
	var img := Image.create(128, 128, false, Image.FORMAT_L8)
	for y in 128:
		for x in 128:
			img.set_pixel(x, y, Color.WHITE if y < 44 else Color.BLACK)
	img.generate_mipmaps()
	_tex["band"] = ImageTexture.create_from_image(img)
	return _tex["band"]


func _wear() -> Texture2D:
	if _tex.has("wear"):
		return _tex["wear"]
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	var n := _noise(0.12, 3)
	for y in 64:
		for x in 64:
			var v := 0.85 + 0.3 * n.get_noise_2d(x, y)
			img.set_pixel(x, y, Color(v, v, v).clamp())
	img.generate_mipmaps()
	_tex["wear"] = ImageTexture.create_from_image(img)
	return _tex["wear"]

extends RefCounted
## Pet materials for G-GAME (through Look.pet_material): `coat` (wet fur sheen; corgi ochre/tan, cat grey tabby),
## `plate` (scuffed ochre armour with a team band that stays readable at 30 m at night), `metal` (rifle metal).
## One cached material per (kind, species, team), so every pet of a side shares it and batches. Object-space
## triplanar mapping: any placeholder or final mesh works without UVs. species: 0 corgi, 1 cat. team: 0 Corgi Company,
## 1 Cat Cadre (the locked team signal colours of the web game's PALETTE.teamCorgis / teamCats).
const KINDS := ["coat", "plate", "metal"]
const TEAM := [Color("2f6fd6"), Color("c9344a")]
const OCHRE := Color(0.74, 0.53, 0.16)
const CORGI_COAT := Color(0.72, 0.46, 0.26)
const CAT_COAT := Color(0.56, 0.54, 0.52)  # W12 Q6 P1: a grey tabby (cool) against the corgi ochre (warm); the dark tabby went black at night

var _cache := {}
var _tex := {}
var forward_plus := true  # clearcoat (the wet film) only where the renderer has it


func get_material(kind: String, species: int, team: int) -> Material:
	species = clampi(species, 0, 1)
	team = clampi(team, 0, 1)
	var key := "%s_%d_%d" % [kind, species, team]
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.resource_name = "look_pet_" + key
	m.uv1_triplanar = true
	m.uv1_world_triplanar = false
	match kind:
		"coat":
			m.albedo_color = CORGI_COAT if species == 0 else CAT_COAT
			m.albedo_texture = _fur(species)
			m.uv1_scale = Vector3(2.5, 2.5, 2.5)
			m.roughness = 0.42        # wet fur: tight highlights
			m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
			m.rim_enabled = true      # the sheen along the silhouette that sells a wet coat
			m.rim = 0.55
			m.rim_tint = 0.35
			# W12 Q6 P1: a character-only readability fill (the web's P4 lesson: readability at range is lighting). Away
			# from the floods a pet was a black silhouette; a faint self-lit coat keeps species colour and shape readable
			# at 30 m, well below the glow threshold.
			m.emission_enabled = true
			m.emission = CORGI_COAT if species == 0 else CAT_COAT
			m.emission_texture = _fur(species)
			m.emission_energy_multiplier = 0.28
		"plate":
			m.albedo_texture = _plate(team)
			m.uv1_scale = Vector3(1.4, 1.4, 1.4)
			m.roughness = 0.38
			m.metallic = 0.1
			# the team band glows faintly (below the glow threshold): the side reads at 30 m in the dark and fog
			m.emission_enabled = true
			m.emission = TEAM[team]
			m.emission_energy_multiplier = 1.0  # W12 Q6 P1: was 0.55; still below the glow threshold
			m.emission_texture = _band_mask()
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
			push_warning("Look.pet_material: unknown kind '%s' (want coat, plate or metal)" % kind)
			m.albedo_color = Color(0.4, 0.4, 0.4)
	_cache[key] = m
	return m


func _noise(freq: float, seed_: int) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = seed_
	n.frequency = freq
	n.fractal_octaves = 4
	return n


## Fur: vertical strands (corgi: tan with a lighter wash; cat: dark tabby bands with a wobble).
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
				v *= lerpf(1.0, 0.35, smoothstep(0.2, 0.7, band))
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
			var c: Color = TEAM[team] if y < 44 else OCHRE
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

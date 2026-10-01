// Moonlit overcast NIGHT sky (G-ATMOS, Wave 13; first cut G-LOOK, Wave 12). A blue-black zenith over a low cloud deck
// lit from above by a moon hidden behind it: the deck's base is a cold slate, a little brighter around the moon and at
// its thin edges; through the breaks a darker sky with a few faint stars, and the moon itself where a break passes in
// front of it. The horizon is a cold haze: no warm sodium wash. Static (no TIME), so the radiance map is not rebuilt
// every frame. look.gd's fog colour matches `horizon_color` (both sRGB; the shader works in linear).
shader_type sky;

uniform vec3 zenith_color : source_color = vec3(0.03, 0.042, 0.08);
uniform vec3 horizon_color : source_color = vec3(0.11, 0.13, 0.17);
uniform vec3 cloud_lit : source_color = vec3(0.17, 0.19, 0.24);
uniform vec3 cloud_dark : source_color = vec3(0.045, 0.055, 0.08);
uniform vec3 moon_color : source_color = vec3(0.82, 0.87, 1.0);
uniform vec3 star_color : source_color = vec3(0.75, 0.8, 0.95);
uniform vec3 moon_dir = vec3(-0.4, 0.55, -0.73);
uniform float cloud_cover : hint_range(0.0, 1.0) = 0.74;
uniform float moon_energy = 3.0;
uniform float star_energy = 0.6;
uniform float energy = 1.0;
uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

// Sparse faint stars on a lattice of the view direction (static; about 1 px each at 1280 x 720).
float stars(vec3 d) {
	vec3 p = d * 260.0;
	vec3 c = floor(p);
	float h = hash13(c);
	if (h < 0.97) {
		return 0.0;
	}
	vec3 o = vec3(hash13(c + 7.1), hash13(c + 13.7), hash13(c + 29.3)) * 0.6 + 0.2;
	return smoothstep(0.35, 0.0, length(p - c - o)) * (h - 0.97) / 0.03;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float up = clamp(d.y, 0.0, 1.0);
	vec3 md = normalize(moon_dir);
	float m = max(dot(d, md), 0.0);
	// the sky above the deck (seen through the breaks): blue-black overhead, a cold haze low down
	vec3 base = mix(horizon_color, zenith_color, pow(up, 0.4));
	// the deck: a flat layer, projected; two octaves of the same noise
	vec2 uv = d.xz / (up + 0.12);
	float n = texture(cloud_noise, uv * 0.07 + vec2(0.13, 0.71)).r * 0.65 + texture(cloud_noise, uv * 0.23).r * 0.35;
	float lo = 0.85 - cloud_cover;
	float cover = smoothstep(lo, lo + 0.3, n);
	// a break drifts across the moon; the deck closes towards the horizon (no breaks low down, no stars on the skyline)
	cover *= mix(1.0, smoothstep(0.35, 0.75, n), smoothstep(0.985, 0.998, m));
	cover = mix(1.0, cover, smoothstep(0.03, 0.3, up));
	float thin = 1.0 - clamp((n - lo) * 2.2, 0.0, 1.0);  // thin edges let more moonlight through
	float glow = pow(m, 6.0) * 0.6 + pow(m, 40.0) * 1.4;   // the moon's patch on the deck
	vec3 deck = mix(cloud_dark, cloud_lit, clamp(thin * 0.6 + glow * 0.5, 0.0, 1.0)) * (1.0 + glow);
	deck = mix(deck, horizon_color, 1.0 - smoothstep(0.0, 0.18, up));  // the deck's far edge sinks into the haze
	// the break: night sky, faint stars, the moon (a small soft disc and its corona)
	vec3 clear = base * (1.0 + pow(m, 10.0) * 2.0);
	clear += moon_color * (smoothstep(0.99982, 0.99992, m) * moon_energy + pow(m, 300.0) * 0.08 * moon_energy);
	clear += star_color * stars(d) * star_energy * smoothstep(0.1, 0.35, up);
	vec3 col = mix(clear, deck, cover);
	if (d.y < 0.0) {
		col = mix(horizon_color, horizon_color * 0.35, clamp(-d.y * 4.0, 0.0, 1.0));
	}
	COLOR = col * energy;
}

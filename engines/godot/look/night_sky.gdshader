// Moonlit overcast night sky (G-LOOK, Wave 12): a blue-grey cloud deck, brighter where the moon sits behind it, and a
// warm sodium glow on the low cloud base (the city and the Lot's own floods). Static (no TIME), so the radiance map
// is not rebuilt every frame. The fog colour in look.gd matches `horizon_color`.
shader_type sky;

uniform vec3 zenith_color : source_color = vec3(0.07, 0.085, 0.11);
uniform vec3 horizon_color : source_color = vec3(0.2, 0.22, 0.25);
uniform vec3 cloud_lit : source_color = vec3(0.34, 0.37, 0.42);
uniform vec3 cloud_dark : source_color = vec3(0.08, 0.09, 0.115);
uniform vec3 glow_color : source_color = vec3(0.5, 0.32, 0.16);
uniform vec3 moon_dir = vec3(-0.4, 0.55, -0.73);
uniform float cloud_cover : hint_range(0.0, 1.0) = 0.8;
uniform float energy = 1.0;
uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;

void sky() {
	vec3 d = EYEDIR;
	float up = clamp(d.y, 0.0, 1.0);
	vec3 base = mix(horizon_color, zenith_color, pow(up, 0.55));
	vec2 uv = d.xz / (up + 0.1);
	float n = texture(cloud_noise, uv * 0.07 + vec2(0.13, 0.71)).r * 0.65 + texture(cloud_noise, uv * 0.23).r * 0.35;
	float c = smoothstep(0.85 - cloud_cover, 1.25 - cloud_cover, n) * smoothstep(0.0, 0.1, up);
	float m = max(dot(d, normalize(moon_dir)), 0.0);
	float moonlit = pow(m, 5.0) * 0.8 + pow(m, 48.0) * 1.2;
	vec3 clouds = mix(cloud_dark, cloud_lit, clamp(n * 1.3 - 0.2, 0.0, 1.0)) * (1.0 + moonlit);
	vec3 col = mix(base * (1.0 + moonlit * 0.5), clouds, c);
	col += glow_color * exp(-up * 8.0) * 0.4;
	if (d.y < 0.0) {
		col = mix(horizon_color + glow_color * 0.4, cloud_dark * 0.5, clamp(-d.y * 3.0, 0.0, 1.0));
	}
	COLOR = col * energy;
}

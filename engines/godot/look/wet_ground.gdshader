// Wet night asphalt for group `ground` (G-LOOK, Wave 12). World-space mapped, so any terrain mesh works: no UVs or
// tangents needed. Roughness split: puddles (noise mask, flat ground only) ~0.05, the rest 0.55-0.7. Detail normal
// off the puddles; optional rain ripples in them. The terrain's vertex colours (ruts, mud) tint the asphalt.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D grain_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D puddle_tex : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform sampler2D detail_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 asphalt_dark : source_color = vec3(0.10, 0.10, 0.105);
uniform vec3 asphalt_light : source_color = vec3(0.24, 0.235, 0.225);
uniform float grain_scale = 2.2;       // metres per grain tile
uniform float puddle_scale = 24.0;     // metres per puddle-mask tile
uniform float puddle_cut : hint_range(0.0, 1.0) = 0.6;  // higher = fewer puddles
uniform float puddle_rough : hint_range(0.0, 1.0) = 0.05;
uniform vec2 dry_rough = vec2(0.55, 0.7);
uniform float detail_strength : hint_range(0.0, 2.0) = 0.55;
uniform float vertex_color_mix : hint_range(0.0, 1.0) = 0.35;
uniform float wetness : hint_range(0.0, 1.0) = 1.0;
uniform float rain : hint_range(0.0, 1.0) = 0.0;  // ripples in puddles (0 = off, no cost beyond one branch)

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

float hash12(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// One expanding ring per cell, random centre and phase: returns a world-xz normal offset.
vec2 ripple(vec2 p, float t) {
	vec2 cell = floor(p);
	float h = hash12(cell);
	vec2 v = fract(p) - 0.5 - (vec2(fract(h * 17.3), fract(h * 31.7)) - 0.5) * 0.5;
	float d = length(v);
	float ph = fract(t + h);
	float w = sin((d - ph * 0.45) * 70.0) * smoothstep(0.05, 0.0, abs(d - ph * 0.45)) * (1.0 - ph);
	return v / max(d, 1e-3) * w;
}

void fragment() {
	vec2 p = wpos.xz;
	float g = texture(grain_tex, p / grain_scale).r;
	float g2 = texture(grain_tex, p / (grain_scale * 9.7) + vec2(0.37, 0.11)).r;
	vec3 alb = mix(asphalt_dark, asphalt_light, clamp(g * 0.55 + g2 * 0.6 - 0.1, 0.0, 1.0));
	alb *= mix(vec3(1.0), COLOR.rgb, vertex_color_mix);
	float flat_ground = smoothstep(0.94, 0.985, wnrm.y);
	float pm = texture(puddle_tex, p / puddle_scale).r + (g - 0.5) * 0.12;  // grain breaks the puddle rims
	float puddle = smoothstep(puddle_cut, puddle_cut + 0.06, pm) * flat_ground * wetness;
	// damp edge ring around each puddle: darker, smoother than the dry-ish asphalt
	float damp = smoothstep(puddle_cut - 0.12, puddle_cut, pm) * flat_ground * wetness;
	alb *= mix(1.0, 0.62, wetness);        // wet asphalt darkens
	alb *= mix(1.0, 0.88, damp);
	alb = mix(alb, alb * 0.55, puddle);    // standing water: darker, the reflection carries it
	float rough = mix(dry_rough.x, dry_rough.y, g);
	rough = mix(rough, rough * 0.7, damp);
	rough = mix(rough, puddle_rough, puddle);

	vec2 dn = texture(detail_nrm, p / grain_scale).xy * 2.0 - 1.0;
	vec3 n = wnrm + vec3(dn.x, 0.0, dn.y) * detail_strength * (1.0 - puddle);
	if (rain > 0.0) {
		vec2 r = ripple(p * 1.7, TIME * 1.1) + ripple(p * 2.3 + 5.1, TIME * 0.9 + 0.5);
		n += vec3(r.x, 0.0, r.y) * 0.22 * rain * puddle;
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(normalize(n), 0.0)).xyz);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	SPECULAR = 0.5;
}

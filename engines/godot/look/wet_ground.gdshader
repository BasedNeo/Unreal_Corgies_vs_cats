// Wet night asphalt for group `ground` (G-ATMOS, Wave 13; first cut G-LOOK, Wave 12). World-space mapped, so any
// terrain mesh works: no UVs or tangents needed. What makes it read as asphalt and not mud:
// - a dark grey-black binder with fine light aggregate (cellular noise, ~1 cm stones) and worn, lighter patches;
// - paving joints (long lane seams, a rare cross joint) and a sparse crack network, both sealed with glossy tar;
// - patch repairs: a fresher (darker) rectangle with a sealed edge in one panel in four; a few older (greyer) panels;
// - a wet film: roughness 0.3-0.45 (it takes the floods' sodium sheen), puddles 0.03 (sharp reflections; SSR on
//   Forward+), a darker damp rim; rain ripples in the puddles;
// - slopes (berms, ditch banks) are broken, rougher, unpaved-looking aggregate: no joints and no puddles.
// The terrain's vertex colours (if any) only shade it (their luminance): they never tint it brown.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D grain_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;  // wear, mid scale
uniform sampler2D agg_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;    // aggregate
uniform sampler2D crack_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;  // cellular edges
uniform sampler2D puddle_tex : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform sampler2D detail_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 asphalt_dark : source_color = vec3(0.17, 0.17, 0.175);   // fresh binder
uniform vec3 asphalt_light : source_color = vec3(0.3, 0.3, 0.3);       // worn, aged
uniform vec3 aggregate_color : source_color = vec3(0.4, 0.4, 0.39);    // the stones
uniform vec3 tar_color : source_color = vec3(0.025, 0.025, 0.028);    // crack and joint sealant
uniform float grain_scale = 9.0;       // metres per wear tile
uniform float agg_scale = 0.8;         // metres per aggregate tile
uniform float crack_scale = 26.0;      // metres per crack-network tile
uniform vec2 panel_size = vec2(4.5, 14.0);  // paving lane width (x) and cross-joint spacing (z), metres
uniform float joint_width = 0.08;      // metres of tar across a joint
uniform float puddle_scale = 24.0;     // metres per puddle-mask tile
uniform float puddle_cut : hint_range(0.0, 1.0) = 0.6;  // higher = fewer puddles
uniform float puddle_rough : hint_range(0.0, 1.0) = 0.03;
uniform vec2 wet_rough = vec2(0.3, 0.45);   // the wet film on the binder (aggregate peaks rougher)
uniform float slope_rough = 0.62;
uniform float detail_strength : hint_range(0.0, 2.0) = 0.35;
uniform float vertex_color_mix : hint_range(0.0, 1.0) = 0.3;
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

// Anti-aliased thin line: 1 on a line of half-width `w` at distance `d` (same units), fading out where a pixel spans
// more than the line (far away it greys into the surface instead of shimmering).
float aa_line(float d, float w, float fw) {
	return (1.0 - smoothstep(w - fw, w + fw, d)) * clamp(w * 2.0 / max(fw, 1e-4), 0.0, 1.0);
}

void fragment() {
	vec2 p = wpos.xz;
	float flat_ground = smoothstep(0.9, 0.97, wnrm.y);  // 0 on berms and banks
	// tones: wear at a few metres and tens of metres, aggregate at a centimetre
	float wear = texture(grain_tex, p / grain_scale).r;
	float wear2 = texture(grain_tex, p / (grain_scale * 5.3) + vec2(0.37, 0.11)).r;
	float agg = texture(agg_tex, p / agg_scale).r;
	float agg2 = texture(agg_tex, p / (agg_scale * 0.37) + vec2(0.5, 0.25)).r;
	// paving: lanes along z with a tar-sealed joint between them, a rare cross joint, and in one panel in four a patch
	// repair (a fresher, darker rectangle with a sealed edge)
	vec2 q = p / panel_size;
	q.y += hash12(vec2(floor(q.x), 3.7));
	vec2 cell = floor(q);
	vec2 f = fract(q);
	float age = hash12(cell + 0.5);
	vec2 jfw = fwidth(p) * 1.5;
	vec2 jd = (0.5 - abs(f - 0.5)) * panel_size;  // metres to the panel's edges
	float joint = max(aa_line(jd.x, joint_width * 0.5, jfw.x),
			aa_line(jd.y, joint_width * 0.5, jfw.y) * step(0.8, hash12(cell + 9.1)));
	vec4 rr = vec4(hash12(cell + 1.3), hash12(cell + 2.9), hash12(cell + 4.1), hash12(cell + 6.7));
	vec2 plo = vec2(0.1 + rr.x * 0.25, 0.08 + rr.y * 0.45);
	vec2 phi = min(plo + vec2(0.3 + rr.z * 0.3, 0.12 + rr.w * 0.3), vec2(0.92));
	vec2 pd = min(f - plo, phi - f) * panel_size;  // metres inside the patch (negative: outside)
	float pin = min(pd.x, pd.y);
	float psd = pin >= 0.0 ? pin : length(max(-pd, vec2(0.0)));
	float has_patch = step(0.75, age);
	float in_patch = has_patch * step(0.0, pin);
	joint = max(joint, has_patch * aa_line(psd, joint_width * 0.5, max(jfw.x, jfw.y)));
	// cracks: domain-warped cellular edges, only where a low-frequency mask says the surface is old
	float ce = texture(crack_tex, p / crack_scale).r;
	float crack = aa_line(ce, 0.012, fwidth(ce)) * smoothstep(0.42, 0.6, wear2 + (age - 0.5) * 0.4) * (1.0 - in_patch);
	float seal = max(joint, crack) * flat_ground;

	float tone = clamp(wear * 0.4 + wear2 * 0.6 - 0.25 - in_patch * 0.3 + step(age, 0.1) * 0.15, 0.0, 1.0);
	vec3 binder = mix(asphalt_dark, asphalt_light, tone);
	float stones = smoothstep(0.55, 0.85, agg) * 0.55 + smoothstep(0.6, 0.9, agg2) * 0.3;
	stones *= mix(0.6, 1.0, tone);  // worn surfaces show more stone
	// berms and banks: coarse dark wet grit, mapped on their own face (no xz stretch); darker, since they face the floods
	vec2 sp = abs(wnrm.x) > abs(wnrm.z) ? wpos.zy : wpos.xy;
	float grit = texture(agg_tex, sp / (agg_scale * 3.0)).r;
	stones = mix(smoothstep(0.4, 0.95, grit) * 0.7, stones, flat_ground);
	vec3 alb = mix(binder, aggregate_color, clamp(stones, 0.0, 1.0));
	alb *= mix(0.55, 1.0, flat_ground);
	float vl = dot(COLOR.rgb, vec3(0.299, 0.587, 0.114));
	alb *= mix(1.0, vl, vertex_color_mix);
	alb = mix(alb, tar_color, seal);

	// water: puddles on the flat (grain breaks the rims), a damp rim, the wet film everywhere
	float pm = texture(puddle_tex, p / puddle_scale).r + (agg - 0.5) * 0.05 + (wear - 0.5) * 0.08;
	float puddle = smoothstep(puddle_cut, puddle_cut + 0.035, pm) * flat_ground * wetness;
	float damp = smoothstep(puddle_cut - 0.1, puddle_cut, pm) * flat_ground * wetness;
	alb *= mix(1.0, 0.7, wetness);       // wet asphalt darkens
	alb *= mix(1.0, 0.8, damp);
	alb = mix(alb, alb * 0.6, puddle);   // shallow standing water: the asphalt shows through, the reflection on top
	float rough = mix(wet_rough.x, wet_rough.y, clamp(stones * 1.4, 0.0, 1.0));
	rough = mix(mix(0.75, 0.9, stones), rough, wetness);
	rough = mix(slope_rough + stones * 0.15, rough, flat_ground);
	rough = mix(rough, 0.18, seal * wetness);  // tar sheds water: a glossy black line
	rough = mix(rough, rough * 0.6, damp);
	rough = mix(rough, puddle_rough, puddle);

	vec2 dn = texture(detail_nrm, p / agg_scale).xy * 2.0 - 1.0;
	vec3 n = wnrm + vec3(dn.x, 0.0, dn.y) * detail_strength * (1.0 - puddle) * (1.0 - seal * 0.7);
	if (rain > 0.0) {
		vec2 r = ripple(p * 1.7, TIME * 1.1) + ripple(p * 2.3 + 5.1, TIME * 0.9 + 0.5);
		n += vec3(r.x, 0.0, r.y) * 0.12 * rain * puddle;
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(normalize(n), 0.0)).xyz);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	SPECULAR = mix(0.5, 0.9, puddle);  // a stronger mirror in the puddles (stylised: F0 0.04 -> 0.07)
}

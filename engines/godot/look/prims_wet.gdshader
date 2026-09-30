// Wet procedural props (group `prims`, G-LOOK, Wave 12). G-WORLD's merged prims mesh carries the palette colour in
// COLOR (linear) and (roughness, metallic) in UV2; this keeps both and wets them: darker, smoother, world-space grime
// and rain streaks so flat-coloured boxes stop reading as plastic.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D grime_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform bool uv2_pbr = true;           // false: a plain mesh without UV2 (fallback roughness / metallic below)
uniform vec4 base_color : source_color = vec4(1.0);
uniform bool use_vertex_color = true;
uniform float fallback_roughness = 0.8;
uniform float fallback_metallic = 0.0;
uniform float wet_darken : hint_range(0.0, 1.0) = 0.72;
uniform float wet_rough : hint_range(0.0, 1.0) = 0.55;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 c = base_color.rgb * (use_vertex_color ? COLOR.rgb : vec3(1.0));
	vec3 an = abs(wnrm);
	// cheap triplanar grime: one sample on the dominant axis
	vec2 tp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
	float g = texture(grime_tex, tp * 0.45).r;
	float streak = texture(grime_tex, vec2((wpos.x + wpos.z) * 0.6, wpos.y * 0.06)).r;
	float r0 = uv2_pbr ? UV2.x : fallback_roughness;
	float m0 = uv2_pbr ? UV2.y : fallback_metallic;
	float wet = mix(0.8, 1.0, smoothstep(0.4, 0.6, streak) * (1.0 - an.y));
	ALBEDO = c * mix(0.8, 1.1, g) * mix(1.0, wet_darken, wet);
	ROUGHNESS = clamp(r0 * mix(1.0, wet_rough, wet) * mix(0.85, 1.15, g) * mix(1.0, 0.6, step(0.9, wnrm.y)), 0.06, 1.0);
	METALLIC = m0;
}

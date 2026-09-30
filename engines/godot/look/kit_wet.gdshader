// Wet kit GLB pieces (G-LOOK, Wave 12). Reads the master's own maps (baseColor, ORM, normal: never replaced) and
// wets them: darker albedo, lower roughness, rain streaks down vertical faces, a thin clearcoat film.
// Paint mask (ASSET_PIPELINE P-GLB1b): baseColor alpha = 1 + 254 x mask; the per-instance colour (MultiMesh COLOR)
// tints only the paint, so rust, grime and frames keep their own colour.
// Optional emission (the FloodLamp lens): emission_tex x emission_color x emission_energy.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D albedo_tex : source_color, hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D streak_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D emission_tex : source_color, hint_default_black, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform bool paint_tint = false;
uniform bool has_orm = true;
uniform bool has_normal = true;
uniform float metallic_scale = 1.0;
uniform float roughness_scale = 1.0;
uniform float wet_darken : hint_range(0.0, 1.0) = 0.72;
uniform float wet_rough : hint_range(0.0, 1.0) = 0.55;
uniform float clearcoat_amount : hint_range(0.0, 1.0) = 0.0;
uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 a = texture(albedo_tex, UV);
	vec3 alb = a.rgb * albedo_color.rgb;
	if (paint_tint) {
		float mask = clamp((a.a * 255.0 - 1.0) / 254.0, 0.0, 1.0);
		alb *= mix(vec3(1.0), COLOR.rgb, mask);
	}
	vec3 orm = has_orm ? texture(orm_tex, UV).rgb : vec3(1.0, 1.0, 0.0);
	// streaks: running water on walls (vertical faces), puddled film on top faces
	float vert = 1.0 - abs(wnrm.y);
	float s = texture(streak_tex, vec2((wpos.x + wpos.z) * 0.35, wpos.y * 0.04)).r;
	float wet = mix(0.75, 1.0, smoothstep(0.35, 0.65, s) * vert) ;
	// porous (non-metal) surfaces soak and darken more than painted metal: canvas bags, concrete
	ALBEDO = alb * mix(1.0, wet_darken, wet) * mix(1.0, 0.6, 1.0 - orm.b);
	// soaked canvas / concrete stay fairly rough; painted metal gets the water film
	float wr = mix(wet_rough, 0.85, 1.0 - orm.b);
	ROUGHNESS = clamp(orm.g * roughness_scale * mix(1.0, wr, wet) * mix(1.0, 0.8, step(0.9, wnrm.y)), 0.04, 1.0);
	METALLIC = orm.b * metallic_scale;
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.3;
	if (has_normal) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
	}
	CLEARCOAT = clearcoat_amount;
	CLEARCOAT_ROUGHNESS = 0.15;
	EMISSION = texture(emission_tex, UV).rgb * emission_color * emission_energy;
}

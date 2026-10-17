// Wet kit GLB pieces (G-LOOK, Wave 12). Reads the master's own maps (baseColor, ORM, normal: never replaced) and
// wets them: darker albedo, lower roughness, rain streaks down vertical faces, a thin clearcoat film.
// Paint mask (ASSET_PIPELINE P-GLB1b): baseColor alpha = 1 + 254 x mask; the per-instance colour (MultiMesh COLOR)
// tints only the paint, so rust, grime and frames keep their own colour.
// Optional emission (the FloodLamp lens): emission_tex x emission_color x emission_energy.
// The cover read (G-ATMOS, Wave 15; shared with the web twin, which copies it): on the piece's cover zone (mesh height
// under cover_top, from look.gd COVER), emission adds
//   fill  = cover_fill x (1 - cover_pool x pool) x held, where
//     held = the wet albedo x clamp(cover_mean, cover_floor, cover_ceil) / cover_mean: one gain per piece that puts its
//            mean base-colour luminance (cover_mean, look.gd COVER_MEAN, from its GLB) in the band, so the fill keeps
//            the albedo's texture; a texel's held luminance is then kept in [cover_lo, cover_cap] (a wide guard for
//            outliers only: near-black frames and seams, glare-white decals); its saturation is then x cover_sat;
//     pool = the strongest flood cone the fragment stands in: max over the floods of
//            smoothstep(0.848, 0.961, dot(normalize(world pos - lamp), the lamp's unit aim)), i.e. 1 inside 16 degrees of
//            a flood's axis, 0 outside its 32-degree spot (look.gd floods: spot_angle 32), so the read lifts what the
//            floods leave dark and leaves what they light;
//   sheen = cover_sheen x the moon's colour x (1 - N.V)^cover_sheen_power x (1 - smoothstep(0.85, 0.97, world N.y)),
//           on the geometric normal, never on a flat up-facing face (a floor or a flat top, always grazing from eye height).
// Parts that do not shield a pet (the mast above the ballast, the lamp heads: cover_top 0) stay as they were: matte
// and dark. The emission stays under the glow threshold (tests/test_look_cover.gd).
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
uniform float cover_top = 0.0;
uniform float cover_fill = 0.0;
uniform float cover_floor = 0.0;  // the piece's mean base-colour luminance is held between floor and ceil (one gain per
uniform float cover_ceil = 1.0;   // piece, so dark paint and pale sacks both land at a readable value, texture kept)
uniform float cover_mean = 0.25;  // the piece's mean base-colour luminance (look.gd COVER_MEAN)
uniform float cover_lo = 0.0;     // outlier guard: no texel's held luminance below this (near-black frames, seams)
uniform float cover_cap = 1.0;    // outlier guard: no texel's held luminance above this
uniform float cover_pool = 0.0;   // how far the fill fades inside a flood's cone (0: not at all, 1: gone)
uniform vec3 cover_flood_pos[8];  // the floods' lamps (World.floodlights() pos)
uniform vec3 cover_flood_aim[8];  // unit vectors from each lamp to its target
uniform int cover_flood_count = 0;
uniform float cover_sat = 1.0;    // the fill's saturation (Forward+'s AgX desaturates a self-lit term more than Compatibility)
uniform float cover_sheen = 0.0;
uniform float cover_sheen_power = 2.5;
uniform vec3 cover_sheen_color : source_color = vec3(0.62, 0.72, 0.95);

varying vec3 wpos;
varying vec3 wnrm;
varying float ly;

void vertex() {
	ly = VERTEX.y;
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
	vec3 wet_alb = alb * mix(1.0, wet_darken, wet) * mix(1.0, 0.6, 1.0 - orm.b);
	ALBEDO = wet_alb;
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
	float cover = step(ly, cover_top) * step(0.001, cover_top);
	if (cover > 0.0) {
		// the sheen rims what turns away from the eye, on the piece's sides: a flat up-facing face (a floor, a flat top)
		// seen from eye height is always at a grazing angle and would wash out whole (W15 Q-check: the container floor)
		float graze = pow(1.0 - clamp(dot(normalize(NORMAL), VIEW), 0.0, 1.0), cover_sheen_power)
				* (1.0 - smoothstep(0.85, 0.97, wnrm.y));
		// the fill keeps the albedo's texture: one gain per piece (W15 Q-check: a per-texel clamp made a flat block)
		vec3 held = wet_alb * (clamp(cover_mean, cover_floor, cover_ceil) / max(cover_mean, 1e-4));
		float hl = dot(held, vec3(0.2126, 0.7152, 0.0722));
		held = mix(vec3(cover_lo), held * (clamp(hl, cover_lo, cover_cap) / max(hl, 1e-4)), step(1e-4, hl));
		held = max(mix(vec3(dot(held, vec3(0.2126, 0.7152, 0.0722))), held, cover_sat), vec3(0.0));
		// the flood pools: the fill fades where a flood's cone already lights the piece
		float pool = 0.0;
		for (int i = 0; i < cover_flood_count; i++) {
			pool = max(pool, smoothstep(0.848, 0.961, dot(normalize(wpos - cover_flood_pos[i]), cover_flood_aim[i])));
		}
		EMISSION += held * cover_fill * (1.0 - cover_pool * pool) + cover_sheen_color * cover_sheen * graze;
	}
}

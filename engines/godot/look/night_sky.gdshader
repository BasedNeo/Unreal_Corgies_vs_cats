// The night sky (G-ATMOS; W17 AAA pass 1, G-SKY): the shared sky SOURCE, assets/sky/lot_night_sky.exr, which Godot
// and the web twin both sample. It is a Blender Cycles equirect of the locked night: a low overcast deck lit from below
// by the yard's sodium, darker slate toward the zenith, a cold haze at the horizon. look.gd reads it at runtime from
// the repo (no copy under engines/godot), and its receipt (horizon and zenith colours) at startup.
// - Axes: the EXR is in Godot's SKY_COORDS (u = 0 down -Z, 0.25 +X, 0.5 +Z, 0.75 -X; v = 0 the zenith), so it is
//   sampled at SKY_COORDS as it is (proved with BL-DCC's markers EXR in both renderers: tests/test_look_sky.gd).
// - Mip 0 only (textureLod 0): no mip seam where u wraps.
// - Below the horizon the EXR is a constant dark ground; here the haze sinks from horizon_color (the fog colour, the
//   receipt's horizon) to ground_dark x it, so far silhouettes and the ground's sky reflection sink into one haze.
// - energy scales what the eye sees (the background); light_energy scales the radiance map (AT_CUBEMAP_PASS), which
//   is the Lot's sky ambient and reflections: look.gd sets it so the Lot stays lit as W15 item 11 measured it.
// - Compatibility (4.7.2) runs a sky shader in display space: source_color uniforms arrive unconverted (sRGB) and COLOR
//   is written without encoding, so look.gd sets encode_srgb there only. The maths here is linear on both.
// - use_source false (no EXR: look.gd reports the error) draws a plain gradient between the same horizon and zenith.
// Static (no TIME), so the radiance map is built once.
shader_type sky;

uniform sampler2D source_panorama : filter_linear, repeat_enable, hint_default_black;  // linear HDR: no source_color
uniform bool use_source = true;
uniform float energy = 1.0;
uniform float light_energy = 1.0;
uniform bool encode_srgb = false;
uniform vec3 horizon_color : source_color = vec3(0.29, 0.322, 0.341);
uniform vec3 zenith_color : source_color = vec3(0.234, 0.279, 0.327);
uniform float ground_dark = 0.35;

vec3 srgb_to_linear(vec3 c) {
	return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045)));
}

vec3 linear_to_srgb(vec3 c) {
	return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, lessThan(c, vec3(0.0031308)));
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 hz = encode_srgb ? srgb_to_linear(horizon_color) : horizon_color;
	vec3 zn = encode_srgb ? srgb_to_linear(zenith_color) : zenith_color;
	vec3 col = use_source ? textureLod(source_panorama, SKY_COORDS, 0.0).rgb : mix(hz, zn, pow(clamp(d.y, 0.0, 1.0), 0.4));
	vec3 ground = mix(hz, hz * ground_dark, clamp(-d.y * 4.0, 0.0, 1.0));
	col = mix(col, ground, 1.0 - smoothstep(-0.03, 0.0, d.y)) * (AT_CUBEMAP_PASS ? light_energy : energy);
	if (encode_srgb) {
		col = linear_to_srgb(max(col, vec3(0.0)));
	}
	COLOR = col;
}

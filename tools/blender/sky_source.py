# sky_source.py (W17 AAA pass 1 SKY, lane BL-DCC): the Lot's night sky SOURCE, one equirect both engines sample.
#
# A Cycles CPU equirect of the locked night: a low overcast deck (a plane 300 m up, its underside a diffuse +
# translucent cloud field in world metres) lit warm from below by sodium sources: the Lot's four flood towers
# (engines/godot/data/the_lot.json floodlights[].pos, never hand-typed), a seeded ring of yard sodium beyond the fence
# (220-420 m), a seeded far ring of port/city sodium (0.8-3 km) and, v2, a seeded cluster of sodium beyond each flood
# tower on its bearing from the yard (0.7-2.2 km); a dim teal light from below (city light under the rain haze) lights
# the cloud masses; a cool skyglow above shows faintly through the gaps; distant deck melts into the rain haze at the
# horizon. Lamps are invisible to the camera: the SOURCE is sky only (the engines draw their own lamps).
# History (docs/handoff/BL-DCC.md has the numbers):
# - v1: the W17 spike's sky_source_v2 -> sky_v4 with its judge's fix (dist 0.3, stretch 0.55, power 0.04, kelvin 3000,
#   glow_g 0.036, glow_b 0.043, far 0.6), then BL-DCC's look check against docs/design/refs/hardened-corgi-hero.jpg:
#   the far ring shines up in 140 deg cones (far_cone: its warmth stays low, not overhead), the ambient from below
#   (amb), and a cool horizon haze that is the lightest band (haze 1.6), because it is also both engines' fog colour.
# - v2, after the engines' in-engine verdict (too flat, too blue, not lit from below): the deck is cloud masses (mass,
#   cover, edge, body) with dark gaps (thin 0.2: the skyglow no longer lights the gaps, which made v1 blue and flat),
#   the masses lit by the ambient from below at the target hue (AMB_TINT), wind rolls and wisps that fade out with
#   distance (lod0, lod1: no streak band above the horizon), and the flood clusters (cl_*) that put warm patches 5-25
#   deg up on each flood tower's bearing. The receipt's sky.measures records the numbers the engines asked for.
# - v3, after the verdict on v2 at the real hero camera (broken cloud over a clear slate sky: 46 % of tiles at the gap
#   floor, 35 % flat): one continuous deck. The gaps are a dark, underlit lower overcast (under), the mass edge is wide
#   (edge 0.10, body 0.15), so thick and thin parts of one deck make the contrast; rolls and wisps are nearly gone
#   (billows, not wisps); a fine mottle (mottle 0.3) keeps every part of the deck textured; the haze blend is linear to
#   fog_far 4 km, so the deck merges into the horizon haze below about 15 deg. sky.measures.hero_camera has g-atmos's
#   tile measures at the real hero camera (gap floor %, flat %). `--border 1` is a tuning aid only.
#
# Usage (repo root; $BLENDER = the Blender 5.2.2 binary; defaults = the product):
#   "$BLENDER" --background --factory-startup --python tools/blender/sky_source.py
#   "$BLENDER" --background --factory-startup --python tools/blender/sky_source.py -- --w 768 --h 384 --spp 16 --out <scratch>/look
#   "$BLENDER" --background --factory-startup --python tools/blender/sky_source.py -- --markers 1 --w 256 --h 128 --spp 4 --out <scratch>/markers
#
# Writes <out>.exr (scene-linear Rec.709, half float, ZIP, RGB; Standard view transform, no tonemap), <out>.png (8-bit
# AgX preview, for eyes only) and <out>.receipt.json (files, hashes, every parameter, the horizon and zenith colours that
# both engines use for fog and the sky, timings, the rebuild command, the licence line).
# Axes: the camera is turned (90, 0, 180) deg, so the image is in Godot's SKY_COORDS: u = 0 looks down game -Z, 0.25 down
# +X, 0.5 down +Z, 0.75 down -X; v = 0 is the zenith, the horizon lies between rows h/2 - 1 and h/2.
# --markers 1 renders coloured spheres on the game axes instead of the sky, measures where they land, then shows that
# image as a world through bllib.sky_world() and checks the round trip lands them at the same place (exit 1 if not).
import json
import math
import os
import random
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bllib  # noqa: E402

P = bllib.args({
    'out': os.path.join('assets', 'sky', 'lot_night_sky'),
    'w': 2048, 'h': 1024, 'spp': 64, 'thr': 0.01, 'threads': 4, 'markers': 0,
    'measure': '',      # an EXR path: print its look measures (below) as JSON and exit, no render
    'wrap': 32,         # overscan columns past each side of the u = 0 / 1 seam, rendered then cut (no denoiser seam)
    # the judged look (W17 spike run2 RECEIPT Q2_sky.judge, with far raised to 0.6 for the horizon band)
    'fill': 4.5,        # skyglow strength above the deck (what shows through its thin parts)
    'glow_g': 0.036,    # skyglow tint at the zenith (R is fixed at 0.027): teal-slate, not blue
    'glow_b': 0.043,
    'power': 0.04,      # sodium scale for the Lot's floods and the yard ring
    'flood': 0.08,      # extra scale for the Lot's own four floods
    'far': 0.6,         # far ring scale; it multiplies that ring's energy twice (far^2), as in the spike's tuning
    'far_n': 96,        # far ring lamp count
    'kelvin': 3000.0,   # sodium colour temperature (blackbody)
    'dist': 0.3,        # wind-roll noise distortion (1.4 gave marbled swirls)
    'stretch': 0.55,    # wind-roll stretch across the wind (0.3 gave rust streaks)
    'feat': 1.0,        # cloud feature scale
    'fog0': 400.0,      # camera-ray length (m) where the deck starts melting into the horizon haze
    'deck_h': 300.0,    # deck height (m)
    'amb': 0.035,       # scatter-ray light from below the horizon (city light under the rain haze, off wet ground),
                        # blue channel of AMB_TINT; it lights the thick (high-albedo) cloud so billows read lighter
    'thin': 0.2,        # scale of the thin cloud's translucent glow from the skyglow above (lower = darker gaps)
    'bump': 0.35,       # billow relief: bump strength of the thickness field (30 m bump distance)
    'haze': 1.6,        # brightness scale of the horizon haze (the fog colour) the far deck melts into
    'far_cone': 140.0,  # far ring as upward spot cones of this angle (deg; 0 = point lights): their light reaches only
                        # the deck above them, which the yard sees at 5-20 deg (the horizon band), not the deck overhead
    # v2 (the engines' asks after v1): cloud masses with dark gaps, the deck's hue, warm patches on the floods' bearings
    'mass': 400.0,      # cloud mass size (m): the billows
    'cover': 0.5,       # mass threshold on the noise (higher = more gap)
    'edge': 0.1,        # half-width of the mass edge (smoothstep on the noise): lower = harder masses
    'body': 0.15,       # mass shading: albedo rises from the mass edge to cover + body (rounded billows, not plates)
    'roll': 0.1,        # weight of the wind rolls (stretched 150 m noise) inside the masses
    'wisp': 0.08,        # weight of the 40 m breakup on the mass edges
    'lod0': 1500.0,     # camera-ray length (m) where rolls and wisps start fading out (no streaks at grazing angles)
    'lod1': 5000.0,     # ... and where they are gone
    'cl_n': 12,         # sodium cones per flood cluster: on each flood tower's bearing from the yard, beyond it
    'cl_w': 70000.0,    # energy per cluster lamp (W, before kelvin)
    'cl_spread': 9.0,   # bearing spread (deg, sigma) of a cluster
    'cl_r0': 700.0,     # cluster distance range (m) from the yard centre: the deck above is seen at 7-23 deg
    'cl_r1': 2200.0,
    # v3 (the verdict on v2 at the real hero camera: broken cloud over a clear slate sky): one continuous deck
    'under': 0.06,       # albedo of the lower, underlit overcast that fills the gaps between the billows (v2: 0.10)
    'mottle': 0.3,      # fine albedo mottle (14 m and 50 m noise) on the whole deck, faded with distance (lod0, lod1)
    'fog_far': 4000.0,
    'border': 0,        # tuning only: 1 = render just the hero camera's sky region (bearing 188 +- 85, 20-75 deg up) at
                        # full resolution, the rest black; hero_camera tile measures are valid, nothing else is  # camera-ray length (m) where the deck has melted into the horizon haze (FOG_MAX); linear from fog0
})
OUT = P['out']
W, H, SPP = P['w'], P['h'], P['spp']

# Fixed recipe values (scene-linear Rec.709), recorded in the receipt with the parameters.
SLATE_ZEN = (0.0045, 0.0055, 0.0075)    # what camera rays see above the deck's edge
HAZE = tuple(P['haze'] * c for c in (0.0436, 0.0539, 0.0605))   # rain haze at the horizon: cool grey (the reference's low sky r/b 0.72, g/b 0.89)
GROUND = (0.006, 0.0062, 0.0068)        # below the horizon
GLOW_R = 0.027
AMB_TINT = (0.64, 0.85, 1.0)            # v2: the engines' target deck hue in the EXR (r/b 0.65-0.70, g/b 0.86)
DECK_SIZE = 60000.0
FOG_MAX = 0.85
ALBEDO = ((0.10, 0.105, 0.115), (0.62, 0.63, 0.65))        # deck underside albedo, gap -> mass (v1: 0.20 -> 0.58)
TRANSLUCENT = ((0.03, 0.033, 0.04), (0.66, 0.80, 0.80))    # gaps glow cool from the skyglow above (v1: 0.58, 0.66, 0.80)
FLOOD_W, YARD = 60000.0, {'n': 16, 'r': (220.0, 420.0), 'h': (18.0, 34.0), 'w': (90e3, 160e3)}
FAR = {'r': (800.0, 3000.0), 'h': (20.0, 45.0), 'w': (0.15e6, 0.35e6)}
CAMERA_GAME = (0.0, 2.0, 0.0)
BOUNCES = {'max': 4, 'diffuse': 2, 'glossy': 0, 'transmission': 2, 'volume': 1, 'transparent': 2}

bllib.check_blender()
clock = bllib.Clock()
lot = bllib.lot()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
cy = bllib.cycles(sc, SPP, threads=P['threads'], adaptive_threshold=P['thr'], denoise=not P['markers'])
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = BOUNCES['max'], BOUNCES['diffuse'], BOUNCES['glossy']
cy.transmission_bounces, cy.volume_bounces = BOUNCES['transmission'], BOUNCES['volume']
cy.transparent_max_bounces = BOUNCES['transparent']
sc.render.resolution_x, sc.render.resolution_y = W, H
bllib.view(sc, 'Standard')


def ramp_world(world, stops_cam, stops_lit, fill):
    """Camera rays see `stops_cam`, every other ray sees `stops_lit` x fill; both ramps run over the view direction's
    height (Generated Z, -1 down .. 1 up -> 0 .. 1)."""
    wn, wl = world.node_tree.nodes, world.node_tree.links
    wn.clear()
    tc = wn.new('ShaderNodeTexCoord')
    sep = wn.new('ShaderNodeSeparateXYZ')
    wl.new(tc.outputs['Generated'], sep.inputs[0])

    def ramp(stops):
        r = wn.new('ShaderNodeValToRGB')
        els = r.color_ramp.elements
        els[0].position, els[0].color = stops[0][0], tuple(stops[0][1]) + (1,)
        els[1].position, els[1].color = stops[-1][0], tuple(stops[-1][1]) + (1,)
        for pos, c in stops[1:-1]:
            e = els.new(pos)
            e.color = tuple(c) + (1,)
        mr = wn.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = -1.0, 1.0
        wl.new(sep.outputs['Z'], mr.inputs['Value'])
        wl.new(mr.outputs['Result'], r.inputs['Fac'])
        return r

    bg_cam, bg_lit = wn.new('ShaderNodeBackground'), wn.new('ShaderNodeBackground')
    wl.new(ramp(stops_cam).outputs['Color'], bg_cam.inputs['Color'])
    wl.new(ramp(stops_lit).outputs['Color'], bg_lit.inputs['Color'])
    bg_lit.inputs['Strength'].default_value = fill
    lp, mix = wn.new('ShaderNodeLightPath'), wn.new('ShaderNodeMixShader')
    wl.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    wl.new(bg_lit.outputs['Background'], mix.inputs[1])
    wl.new(bg_cam.outputs['Background'], mix.inputs[2])
    wl.new(mix.outputs['Shader'], wn.new('ShaderNodeOutputWorld').inputs['Surface'])


def cloud_field(n, l, coord):
    """A 0..1 deck thickness in world metres: broad masses x wind rolls x fine breakup (seeded 4D noise: W fixed)."""
    def noise(scale, detail, rough, dist, stretch=(1, 1, 1), rot=0.0, w=0.0):
        mp = n.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = stretch
        mp.inputs['Rotation'].default_value = (0, 0, rot)
        l.new(coord, mp.inputs['Vector'])
        nz = n.new('ShaderNodeTexNoise')
        nz.noise_dimensions = '4D'
        nz.inputs['W'].default_value = w
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Roughness'].default_value = rough
        nz.inputs['Distortion'].default_value = dist
        l.new(mp.outputs['Vector'], nz.inputs['Vector'])
        return nz.outputs['Fac']

    def rng(x, a, b, c=0.0, d=1.0):
        m = n.new('ShaderNodeMapRange')
        m.interpolation_type = 'SMOOTHSTEP'
        m.inputs['From Min'].default_value, m.inputs['From Max'].default_value = a, b
        m.inputs['To Min'].default_value, m.inputs['To Max'].default_value = c, d
        l.new(x, m.inputs['Value'])
        return m.outputs['Result']

    def mul(a, b):
        m = n.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        l.new(a, m.inputs[0])
        l.new(b, m.inputs[1])
        return m.outputs[0]

    def madd(a, k, b, c=-0.5):
        """a + k * (b + c) * (fade if given)"""
        m = n.new('ShaderNodeMath')
        m.operation = 'ADD'
        m.inputs[1].default_value = c
        l.new(b, m.inputs[0])
        k2 = n.new('ShaderNodeMath')
        k2.operation = 'MULTIPLY'
        k2.inputs[1].default_value = k
        l.new(m.outputs[0], k2.inputs[0])
        out = n.new('ShaderNodeMath')
        out.operation = 'ADD'
        l.new(a, out.inputs[0])
        l.new(k2.outputs[0], out.inputs[1])
        return out.outputs[0], k2

    F = P['feat']
    # v2: masses (mass m) shifted by a broad coverage field, with wind rolls and 40 m wisps inside them that fade out
    # with distance (lod0 -> lod1, camera-ray length), cut by a smoothstep: masses with dark gaps between them.
    lp = n.new('ShaderNodeLightPath')
    fade = rng(lp.outputs['Ray Length'], P['lod0'], P['lod1'], 1.0, 0.0)
    m0 = noise(1 / (P['mass'] * F), 4.0, 0.55, P['dist'], stretch=(0.8, 1.0, 1.0), rot=0.45, w=7.1)
    m1, _ = madd(m0, 0.35, noise(1 / (1600.0 * F), 2.0, 0.5, 0.2, w=1.3))
    m2, k_roll = madd(m1, P['roll'], noise(1 / (150.0 * F), 6.0, 0.62, P['dist'], stretch=(P['stretch'], 1.0, 1.0),
                                           rot=0.45, w=5.7))
    l.new(mul(fade, k_roll.outputs[0]), m2.node.inputs[1])
    m3, k_wisp = madd(m2, P['wisp'], noise(1 / (40.0 * F), 4.0, 0.6, 0.3, w=3.3))
    l.new(mul(fade, k_wisp.outputs[0]), m3.node.inputs[1])
    # v3: a fine mottle factor (1 +- mottle) for the albedo, faded with distance like the rolls and wisps
    mot = noise(1 / (14.0 * F), 2.0, 0.5, 0.2, w=9.7)
    mot2, _ = madd(mot, 1.0, noise(1 / (50.0 * F), 3.0, 0.55, 0.3, w=11.3))
    mf = n.new('ShaderNodeMath')
    mf.operation = 'MULTIPLY_ADD'                          # 1 + 4 * mottle * (mot2 - 0.5) * fade
    k = n.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = 4.0 * P['mottle']
    l.new(mul(fade, mot2), k.inputs[0])
    off = n.new('ShaderNodeMath')
    off.operation = 'MULTIPLY'
    off.inputs[1].default_value = -0.5 * 4.0 * P['mottle']
    l.new(fade, off.inputs[0])
    tot = n.new('ShaderNodeMath')
    tot.operation = 'ADD'
    l.new(k.outputs[0], tot.inputs[0])
    l.new(off.outputs[0], tot.inputs[1])
    one = n.new('ShaderNodeMath')
    one.operation = 'ADD'
    one.inputs[1].default_value = 1.0
    l.new(tot.outputs[0], one.inputs[0])
    return (rng(m3, P['cover'] - P['edge'], P['cover'] + P['edge']),
            rng(m3, P['cover'] - P['edge'], P['cover'] + P['body']), one.outputs[0])


def deck():
    m = bpy.data.materials.new('CloudDeck')
    n, l = m.node_tree.nodes, m.node_tree.links
    n.clear()
    out = n.new('ShaderNodeOutputMaterial')
    thick, shade, mottle = cloud_field(n, l, n.new('ShaderNodeNewGeometry').outputs['Position'])

    def mix_rgb(fac, a, b):
        mx = n.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.inputs[6].default_value = tuple(a) + (1,)
        mx.inputs[7].default_value = tuple(b) + (1,)
        l.new(fac, mx.inputs[0])
        return mx.outputs[2]

    dif = n.new('ShaderNodeBsdfDiffuse')                   # dense base reflects the sodium
    sca = n.new('ShaderNodeVectorMath')                    # v3: the gap end is the lower overcast (under), all mottled
    sca.operation = 'SCALE'
    l.new(mix_rgb(shade, tuple(P['under'] / ALBEDO[0][1] * c for c in ALBEDO[0]), ALBEDO[1]), sca.inputs[0])
    l.new(mottle, sca.inputs['Scale'])
    l.new(sca.outputs[0], dif.inputs['Color'])
    bump = n.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value, bump.inputs['Distance'].default_value = P['bump'], 30.0
    l.new(thick, bump.inputs['Height'])
    l.new(bump.outputs['Normal'], dif.inputs['Normal'])
    inv = n.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    l.new(thick, inv.inputs[1])
    tr = n.new('ShaderNodeBsdfTranslucent')                # thin parts glow cool from the skyglow above
    l.new(mix_rgb(inv.outputs[0], TRANSLUCENT[0], tuple(P['thin'] * c for c in TRANSLUCENT[1])), tr.inputs['Color'])
    add = n.new('ShaderNodeAddShader')
    l.new(dif.outputs[0], add.inputs[0])
    l.new(tr.outputs[0], add.inputs[1])
    lp = n.new('ShaderNodeLightPath')                      # distance haze, camera rays only
    fog = n.new('ShaderNodeMapRange')
    fog.interpolation_type = 'LINEAR'                      # v3: linear to fog_far (v1/v2: smoothstep to 12 km)
    fog.clamp = True
    fog.inputs['From Min'].default_value, fog.inputs['From Max'].default_value = P['fog0'], P['fog_far']
    fog.inputs['To Max'].default_value = FOG_MAX
    l.new(lp.outputs['Ray Length'], fog.inputs['Value'])
    camf = n.new('ShaderNodeMath')
    camf.operation = 'MULTIPLY'
    l.new(fog.outputs['Result'], camf.inputs[0])
    l.new(lp.outputs['Is Camera Ray'], camf.inputs[1])
    em = n.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = HAZE + (1,)
    em.inputs['Strength'].default_value = 1.0
    mx = n.new('ShaderNodeMixShader')
    l.new(camf.outputs[0], mx.inputs[0])
    l.new(add.outputs[0], mx.inputs[1])
    l.new(em.outputs[0], mx.inputs[2])
    l.new(mx.outputs[0], out.inputs['Surface'])
    me = bpy.data.meshes.new('CloudDeck')                  # one quad facing down at the yard
    s = DECK_SIZE / 2
    me.from_pydata([(-s, -s, 0), (-s, s, 0), (s, s, 0), (s, -s, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(m)
    ob = bpy.data.objects.new('CloudDeck', me)
    ob.location = (0.0, 0.0, P['deck_h'])
    sc.collection.objects.link(ob)
    return ob


def sodium():
    """The Lot's floods (world data), then the seeded yard and far rings (random.Random(SEED), this order)."""
    rnd = random.Random(bllib.SEED)
    lights = []
    for f in bllib.floods(lot):
        lights.append(('flood', f['id'], bllib.g2b(f['pos']), FLOOD_W * P['flood'] * P['power']))
    for i in range(YARD['n']):
        a = 2 * math.pi * i / YARD['n'] + rnd.uniform(-0.15, 0.15)
        r = rnd.uniform(*YARD['r'])
        h = rnd.uniform(*YARD['h'])
        lights.append(('yard', f'yard_{i:02d}', (r * math.cos(a), r * math.sin(a), h), rnd.uniform(*YARD['w']) * P['power']))
    n = P['far_n']
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.5, 0.5) * 2 * math.pi / n
        r = rnd.uniform(*FAR['r'])
        h = rnd.uniform(*FAR['h'])
        lights.append(('far', f'far_{i:02d}', (r * math.cos(a), r * math.sin(a), h), rnd.uniform(*FAR['w']) * P['far'] ** 2))
    crnd = random.Random(bllib.SEED + 1)        # v2 clusters: their own stream, so the rings above keep v1's layout
    for f in bllib.floods(lot):                 # the yard's sodium beyond each flood tower, on its bearing from the yard
        x, _, z = f['pos']
        b0 = math.atan2(x, -z)
        for i in range(P['cl_n']):
            b = b0 + math.radians(crnd.gauss(0.0, P['cl_spread']))
            r = crnd.uniform(P['cl_r0'], P['cl_r1'])
            h = crnd.uniform(*FAR['h'])
            lights.append(('cluster', f"{f['id']}_{i:02d}", bllib.g2b((r * math.sin(b), h, -r * math.cos(b))),
                           P['cl_w'] * crnd.uniform(0.6, 1.4)))
    for k, (group, name, loc, energy) in enumerate(lights):
        cone = group in ('far', 'cluster') and P['far_cone'] > 0
        ld = bpy.data.lights.new(f'Sodium_{k:03d}', 'SPOT' if cone else 'POINT')
        if cone:                                           # same intensity as the point light inside the cone
            ld.spot_size, ld.spot_blend, ld.show_cone = math.radians(P['far_cone']), 1.0, False
        ld.energy = energy
        ld.shadow_soft_size = 2.0
        ld.use_temperature = True
        ld.temperature = P['kelvin']
        ld.color = (1, 1, 1)
        ob = bpy.data.objects.new(ld.name, ld)
        ob.location = loc
        if cone:
            ob.rotation_euler = (math.pi, 0.0, 0.0)            # a spot shines down its -Z: turn it to shine up
        ob.visible_camera = False
        sc.collection.objects.link(ob)
    return lights


def render(path_exr):
    """Render and write the EXR (half float, ZIP, RGB, scene-linear, no render statistics in the header, the seam
    overscan cut off)."""
    return bllib.render_exr(sc, path_exr, clock, crop_x=P['wrap'])


LUMA = np.array([0.2126, 0.7152, 0.0722])
HERO = {'bearing_deg': 193.0, 'pitch_deg': 20.0, 'fov_v_deg': 72.0, 'aspect': 16 / 9}


def view_px(px, bearing, pitch, fov_v=72.0, aspect=16 / 9, w=384):
    """A perspective view sampled from the equirect (nearest texel, linear values): game axes, forward = bearing from -Z
    toward +X (the SKY_COORDS u x 360), pitched up. Returns (rgb, elevation_deg) per pixel."""
    h = int(round(w / aspect))
    f = (h / 2) / math.tan(math.radians(fov_v) / 2)
    xs, ys = np.meshgrid(np.arange(w) - w / 2 + 0.5, h / 2 - np.arange(h) - 0.5)
    b, p = math.radians(bearing), math.radians(pitch)
    fwd = np.array([math.sin(b) * math.cos(p), math.sin(p), -math.cos(b) * math.cos(p)])
    right = np.array([math.cos(b), 0.0, math.sin(b)])
    up = np.cross(right, fwd)
    d = xs[..., None] * right + ys[..., None] * up + f * fwd
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    H_, W_ = px.shape[:2]
    u = (np.arctan2(d[..., 0], -d[..., 2]) / (2 * math.pi)) % 1.0
    v = np.arccos(np.clip(d[..., 1], -1, 1)) / math.pi
    return px[np.clip((v * H_).astype(int), 0, H_ - 1), np.clip((u * W_).astype(int), 0, W_ - 1)], np.degrees(np.arcsin(d[..., 1]))


HERO_CAM = {'eye_game': (0.0, 1.38, -10.0), 'look_game': (-12.0, 40.0, 72.0), 'bearing_deg': 188.0, 'pitch_deg': 25.0,
            'fov_v_deg': 72.0, 'size': (1280, 720), 'sky_rows': 330, 'tile_px': 16}


def hero_frame(px):
    """g-atmos's real hero camera (G-ATMOS.md v2 section): the frame's top `sky_rows` rows sampled bilinearly from
    the equirect (as the engine's linear filter does). Returns linear RGB, shape (rows, width, 3)."""
    c = HERO_CAM
    w, h = c['size']
    f = (h / 2) / math.tan(math.radians(c['fov_v_deg']) / 2)
    xs, ys = np.meshgrid(np.arange(w) - w / 2 + 0.5, h / 2 - np.arange(c['sky_rows']) - 0.5)
    b, p = math.radians(c['bearing_deg']), math.radians(c['pitch_deg'])
    fwd = np.array([math.sin(b) * math.cos(p), math.sin(p), -math.cos(b) * math.cos(p)])
    right = np.array([math.cos(b), 0.0, math.sin(b)])
    up = np.cross(right, fwd)
    d = xs[..., None] * right + ys[..., None] * up + f * fwd
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    H_, W_ = px.shape[:2]
    x = ((np.arctan2(d[..., 0], -d[..., 2]) / (2 * math.pi)) % 1.0) * W_ - 0.5
    y = np.arccos(np.clip(d[..., 1], -1, 1)) / math.pi * H_ - 0.5
    x0, y0 = np.floor(x).astype(int), np.clip(np.floor(y).astype(int), 0, H_ - 2)
    fx, fy = (x - x0)[..., None], np.clip(y - y0, 0, 1)[..., None]
    x0 %= W_
    x1 = (x0 + 1) % W_
    return ((px[y0, x0] * (1 - fx) + px[y0, x1] * fx) * (1 - fy) + (px[y0 + 1, x0] * (1 - fx) + px[y0 + 1, x1] * fx) * fy)


def hero_tiles(px):
    """Tile measures at the real hero camera, linear: gap floor = share of 16 px tiles whose mean luminance is below
    1.25 x p10 (p10 of the pixels); flat = share of tiles with std / mean < 3 %; plus p90/p10, r/b, g/b of the band."""
    rgb = hero_frame(px)
    lum = rgb @ LUMA
    t = HERO_CAM['tile_px']
    r, w = (lum.shape[0] // t) * t, (lum.shape[1] // t) * t
    tl = lum[:r, :w].reshape(r // t, t, w // t, t).transpose(0, 2, 1, 3).reshape(-1, t * t)
    p10, p90 = np.percentile(lum, [10, 90])
    c = rgb.reshape(-1, 3)
    return {'camera': HERO_CAM, 'billow_p90_p10': round(float(p90 / p10), 3),
            'rb': round(float(c[:, 0].mean() / c[:, 2].mean()), 3), 'gb': round(float(c[:, 1].mean() / c[:, 2].mean()), 3),
            'lum_mean': round(float(lum.mean()), 5),
            'gap_floor_pct': round(float((tl.mean(axis=1) < 1.25 * p10).mean() * 100), 1),
            'flat_pct': round(float((tl.std(axis=1) / tl.mean(axis=1) < 0.03).mean() * 100), 1),
            'tiles': int(tl.shape[0])}


def window(px, bearing, half_deg, el0, el1):
    """Equirect texels within +-half_deg of a bearing and between two elevations (deg)."""
    H_, W_ = px.shape[:2]
    el = 90.0 - (np.arange(H_) + 0.5) / H_ * 180.0
    br = (np.arange(W_) + 0.5) / W_ * 360.0
    rows = (el >= el0) & (el <= el1)
    cols = np.abs((br - bearing + 180.0) % 360.0 - 180.0) <= half_deg
    return px[np.ix_(rows, cols)].reshape(-1, 3)


def measures(px, floods_world):
    """The look numbers the engines asked for, from the EXR's linear values (no tonemap).
    billow: p90/p10 of luminance over the sky texels of a view (elevation >= 5 deg: billows, not the horizon haze).
    hue: r/b and g/b = ratios of the channel means over the same texels.
    patch: r/b of the texels within +-10 deg of each flood tower's bearing from the yard centre, 5-25 deg up; control:
    the same window at the bearings between the two flood pairs (90 and 270 deg)."""
    rb = lambda c: round(float(c[:, 0].mean() / c[:, 2].mean()), 3)
    gb = lambda c: round(float(c[:, 1].mean() / c[:, 2].mean()), 3)

    def view(bearing, pitch):
        rgb, el = view_px(px, bearing, pitch, HERO['fov_v_deg'], HERO['aspect'])
        c = rgb[el >= 5.0].reshape(-1, 3)
        lum = c @ LUMA
        p10, p90 = np.percentile(lum, [10, 90])
        return {'bearing_deg': bearing, 'pitch_deg': pitch, 'billow_p90_p10': round(float(p90 / p10), 3),
                'rb': rb(c), 'gb': gb(c), 'lum_mean': round(float(lum.mean()), 5)}

    hero = view(HERO['bearing_deg'], HERO['pitch_deg'])
    ring = [view(float(b), HERO['pitch_deg']) for b in range(0, 360, 45)]
    over = px[: px.shape[0] * 50 // 180].reshape(-1, 3)              # 40-90 deg elevation, every bearing
    patches = []
    for f in floods_world:
        x, _, z = f['pos']
        b = math.degrees(math.atan2(x, -z)) % 360.0
        c = window(px, b, 10.0, 5.0, 25.0)
        patches.append({'id': f['id'], 'bearing_deg': round(b, 1), 'rb': rb(c), 'gb': gb(c),
                        'lum_mean': round(float((c @ LUMA).mean()), 5)})
    control = [{'bearing_deg': b, 'rb': rb(window(px, b, 10.0, 5.0, 25.0))} for b in (90.0, 270.0)]
    return {
        'hero_camera': hero_tiles(px),
        'method': 'EXR linear, no tonemap. hero_camera: g-atmos\'s real hero camera (bearing 188, pitch 25, vertical fov 72, '
                  '1280x720, the top 330 px, bilinear), 16 px tiles: gap_floor_pct = tiles with mean luminance < 1.25 x '
                  'p10 of the pixels, flat_pct = tiles with std/mean < 3 %. Views: nearest-texel perspective resample, vertical fov 72, 16:9, 384 px '
                  'wide, sky texels at elevation >= 5 deg; billow = p90/p10 of Rec.709 luminance; rb / gb = ratio of '
                  'channel means. Hero = bearing 193 deg (toward the tower crane from the slab, game +Z side), pitch '
                  '20 deg: estimated from g-atmos\'s hero shot. Patches: equirect texels within +-10 deg of each flood '
                  'tower\'s bearing from the yard centre (the_lot.json floodlights), 5-25 deg up.',
        'hero': hero,
        'ring_pitch20': ring,
        'billow_p90_p10_ring_min': min(v['billow_p90_p10'] for v in ring),
        'overhead_40_90': {'rb': rb(over), 'gb': gb(over), 'lum_mean': round(float((over @ LUMA).mean()), 5)},
        'flood_patches': patches,
        'control_between_floods': control,
    }


def stats(path_exr):
    """Horizon (the 2 rows at the horizon) and zenith (the top 2 rows) mean linear RGB, azimuth-averaged, read back from
    the written file (after half-float quantisation); elevation-band means for the record."""
    px = bllib.read_pixels(path_exr)
    h = px.shape[0]
    mean = lambda rows: [round(float(v), 6) for v in px[rows].reshape(-1, 3).mean(axis=0)]
    enc = lambda c: [round(float(1.055 * max(v, 0) ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * max(v, 0)), 5) for v in c]
    elev = 90.0 - (np.arange(h) + 0.5) / h * 180.0
    bands = {}
    for lo, hi in ((-90, -5), (-5, 0), (0, 3), (3, 10), (10, 30), (30, 60), (60, 90)):
        bands[f'{lo}..{hi}'] = mean(np.nonzero((elev >= lo) & (elev < hi))[0])
    hz, zn = mean([h // 2 - 1, h // 2]), mean([0, 1])
    return {
        'horizon_linear': hz, 'horizon_srgb': enc(hz), 'horizon_rows': [h // 2 - 1, h // 2],
        'horizon_lum': round(float(np.dot(hz, LUMA)), 6),
        'zenith_linear': zn, 'zenith_srgb': enc(zn), 'zenith_rows': [0, 1],
        'rule': 'mean linear RGB over every column of the named rows (row 0 = top = zenith), read back from the EXR; '
                'srgb = the IEC 61966-2-1 encoding of the linear mean',
        'bands_deg_linear': bands,
        'max': round(float(px.max()), 5), 'mean': round(float(px.mean()), 6),
        'measures': measures(px, bllib.floods(lot)),
    }


# ------------------------------------------------------------------------------------------------ markers mode
MARKERS = {'-Z red': ((0, 2, -100), (1, 0, 0), 0.0), '+X green': ((100, 2, 0), (0, 1, 0), 0.25),
           '+Z blue': ((0, 2, 100), (0, 0, 1), 0.5), '-X yellow': ((-100, 2, 0), (1, 1, 0), 0.75),
           '+Y white': ((0, 102, 0), (1, 1, 1), None)}


def marker_centroids(path_exr):
    px = bllib.read_pixels(path_exr)
    h, w, _ = px.shape
    out = {}
    for k, (_, c, _) in MARKERS.items():
        c = np.array(c, float)
        d = np.abs(px - c * px.max(axis=2, keepdims=True)).sum(axis=2)
        ys, xs = np.nonzero((px.max(axis=2) > 0.3) & (d < 0.25))
        if not len(xs):
            out[k] = None
            continue
        ang = (xs + 0.5) / w * 2 * math.pi
        u = (math.atan2(np.sin(ang).mean(), np.cos(ang).mean()) / (2 * math.pi)) % 1.0
        out[k] = {'u': round(u, 4), 'v': round(float((ys.mean() + 0.5) / h), 4), 'px': int(len(xs))}
    return out


def markers():
    world = bpy.data.worlds.new('Black')
    sc.world = world
    world.node_tree.nodes.clear()
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    world.node_tree.links.new(bg.outputs[0], world.node_tree.nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
    for k, (pos, c, _) in MARKERS.items():
        m = bpy.data.materials.new(k)
        nt = m.node_tree
        nt.nodes.clear()
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = tuple(c) + (1,)
        nt.links.new(e.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=9.0, location=bllib.g2b(pos))
        bpy.context.active_object.data.materials.append(m)
    bllib.pano_camera(sc, CAMERA_GAME, wrap_px=P['wrap'])
    render(OUT + '.exr')
    first = marker_centroids(OUT + '.exr')
    for ob in [o for o in sc.objects if o.type == 'MESH']:          # the round trip: the image as a world
        bpy.data.objects.remove(ob)
    bllib.sky_world(sc, OUT + '.exr')
    render(OUT + '_roundtrip.exr')
    back = marker_centroids(OUT + '_roundtrip.exr')
    ok = True
    for k, (_, _, u_expect) in MARKERS.items():
        a, b = first[k], back[k]
        good = a is not None and b is not None and abs(b['v'] - a['v']) < 0.02
        if good and u_expect is not None:
            du = lambda x, y: abs((x - y + 0.5) % 1.0 - 0.5)
            good = du(a['u'], u_expect) < 0.02 and du(b['u'], a['u']) < 0.02
        if good and u_expect is None:
            good = a['v'] < 0.1
        ok &= good
        print('MARKER', k, 'expect u', u_expect, 'render', a, 'roundtrip', b, 'OK' if good else 'FAIL')
    rep = {'markers': first, 'roundtrip': back, 'camera_euler_deg': bllib.PANO_EULER_DEG, 'pass': bool(ok),
           'blender': bpy.app.version_string}
    with open(OUT + '.markers.json', 'w') as f:
        json.dump(rep, f, indent=1)
    print('MARKERS', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


# ------------------------------------------------------------------------------------------------ main
if P['measure']:
    print('MEASURES', json.dumps(measures(bllib.read_pixels(P['measure']), bllib.floods(lot))))
    sys.exit(0)
if P['markers']:
    markers()

world = bpy.data.worlds.new('LotNight')
sc.world = world
ramp_world(world,
           [(0.0, GROUND), (0.47, GROUND), (0.5, HAZE), (0.56, SLATE_ZEN), (1.0, SLATE_ZEN)],
           [(0.0, tuple(P['amb'] * t for t in AMB_TINT)), (0.47, tuple(P['amb'] * t for t in AMB_TINT)),
            (0.5, (0.005, 0.0055, 0.0065)), (1.0, (GLOW_R, P['glow_g'], P['glow_b']))],
           P['fill'])
deck()
lights = sodium()
bllib.pano_camera(sc, CAMERA_GAME, wrap_px=P['wrap'])
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
if P['border']:
    tw = W + 2 * P['wrap']
    u0, u1 = (HERO_CAM['bearing_deg'] - 85) / 360, (HERO_CAM['bearing_deg'] + 85) / 360
    r = sc.render
    r.use_border, r.use_crop_to_border = True, False
    r.border_min_x, r.border_max_x = (P['wrap'] + u0 * W) / tw, (P['wrap'] + u1 * W) / tw
    r.border_min_y, r.border_max_y = 1 - (90 - 20) / 180, 1 - (90 - 75) / 180
img = render(OUT + '.exr')
exr_space = sc.render.image_settings.linear_colorspace_settings.name
bllib.save_preview(sc, img, OUT + '.png', 'AgX')                   # the preview only; the EXR is already written

sky = stats(OUT + '.exr')
groups = {g: [l for l in lights if l[0] == g] for g in ('flood', 'yard', 'far', 'cluster')}
rec = bllib.write_receipt(
    OUT + '.receipt.json', __file__,
    outputs={
        'exr': bllib.facts(OUT + '.exr', width=W, height=H, encoding='OpenEXR single part, scanline, ZIP, RGB half float',
                           colorspace=f'scene-linear {exr_space}', view_transform='Standard (no tonemap)',
                           projection='equirectangular'),
        'png': bllib.facts(OUT + '.png', width=W, height=H, encoding='PNG 8-bit RGB', view_transform='AgX',
                           use='preview for eyes only; engines sample the EXR'),
    },
    params=P, clock=clock, kind='SOURCE: sky',
    render={'engine': 'Cycles CPU', 'spp': SPP, 'seed': bllib.SEED, 'adaptive_threshold': P['thr'],
            'denoiser': 'OpenImageDenoise (RGB_ALBEDO, ACCURATE prefilter)', 'threads': P['threads'],
            'bounces': BOUNCES, 'clamp_indirect': 2.0, 'light_tree': True},
    recipe={'slate_zenith': SLATE_ZEN, 'haze': HAZE, 'ground': GROUND, 'glow_r': GLOW_R, 'amb_tint': AMB_TINT,
            'deck_size_m': DECK_SIZE,
            'fog_max': FOG_MAX, 'deck_albedo': ALBEDO, 'deck_translucent': TRANSLUCENT,
            'flood_w': FLOOD_W, 'yard_ring': YARD, 'far_ring': FAR,
            'energy_rule': 'flood = flood_w * flood * power; yard = U(yard_ring.w) * power; far = U(far_ring.w) * far^2; '
                           'cluster = cl_w * U(0.6, 1.4) (random.Random(seed + 1)), upward cones like the far ring'},
    world_data={**lot['_source'], 'floodlights': [
        {'id': name, 'blender_xyz': [round(v, 3) for v in loc], 'energy_w': round(e, 3)} for _, name, loc, e in groups['flood']]},
    lights={g: {'count': len(v), 'energy_w_total': round(sum(e for *_, e in v), 1)} for g, v in groups.items()},
    axes={'camera_game_xyz': CAMERA_GAME, 'camera_euler_deg': bllib.PANO_EULER_DEG,
          'convention': "Godot SKY_COORDS: u = 0 game -Z, 0.25 +X, 0.5 +Z, 0.75 -X; v = 0 zenith; row h/2 - 1 | h/2 = horizon",
          'proof': 'sky_source.py --markers 1 (render + bllib.sky_world round trip)'},
    sky=sky,
    determinism='fixed seed, fixed thread count, no stamp metadata, no dither: a rebuild on the same Blender writes '
                'the same bytes (checked in docs/handoff/BL-DCC.md)',
)
print('SKY', rec['outputs']['exr']['sha256'], 'horizon', sky['horizon_linear'], 'zenith', sky['zenith_linear'],
      'render', clock.laps['render'])

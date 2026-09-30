# build-floodtower.py (W11 P-GLB3): builds the two master GLBs of The Lot's floodlight towers (props.ts floodTower()),
# with Blender 5 as a Python module (bpy 5.0.1, Python 3.11). The script is the source (no .blend).
#
#   <venv>/bin/python tools/assets/build-floodtower.py [--out assets/masters] [--samples 48]
#
# Two pieces, because the tower is not one rigid shape in the world data: the ballast base stands square to the map
# (yaw 0) while the lamp bar turns to its tower's aim (yaw 1.50 / -1.13 / 2.81 / 3.14) and each housing is pitched down to
# its target (0.73 / 0.67 / 0.87 / 0.90 rad). One rigid GLB could equal none of the four towers' colliders.
#   Kit_Lot_FloodMast_01   the hazard-ochre ballast base (3.2 x 1.2 x 3.2) with its checker plate and fork-pocket
#                          plates, the tapered mast (r 0.4 -> 0.3, 20.8 m, FLOOD.mast = 22 m to the bar), a base flange with
#                          gussets, a junction box, a conduit and step bolts. Placed at each flood_base collider, yaw 0.
#                          COL_: the 'flood_base' box and the 'flood_mast' cylinder's bounding box (extras sim_shape
#                          'cyl', sim_r, sim_hh: the sim's collider is that cylinder; the kit standard has boxes only).
#   Kit_Lot_FloodLamp_01   one sodium lamp housing (1.3 x 0.95 x 0.7) with a visor, blinders, rear cooling fins, pivot
#                          bosses and a reflector behind the lens. Placed at each flood_head collider (16), turned by
#                          its yaw and pitch. COL_: the 'flood_head' box. Its front (+z) is where lamps-view draws the
#                          glowing sodium tube (WorldData.lamps, 1 cm proud of the face): the light and its glow() stay
#                          the world's, so the GLB carries no emissive (flagged in the manifest).
# The lamp bar (6.4 x 0.4 x 0.4 gunmetal) stays procedural: it turns with the head but is not pitched.
# Colours are baked from the palette (hazardOchre, gunmetal, camoBlack); no piece is tinted per instance, so neither
# carries a paint mask (ASSET_PIPELINE.md: a piece that is never tinted has no alpha).
import argparse
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import (Noise, sstep, mix, col, palette, solve_atlas, face_uv, paint_faces, poly_mesh, box_faces,  # noqa: E402
                    box_polys, build_kit, report)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ATLAS = 1024
PAD = 4

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'masters'))
ap.add_argument('--samples', type=int, default=48)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

layout = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'layout.ts'), encoding='utf8').read()
MAST = float(re.search(r'export const FLOOD = \{ mast: ([\d.]+)', layout).group(1))      # 22: base to the bar
props = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'props.ts'), encoding='utf8').read()
ft = props[props.index('export function floodTower('):]
ft = ft[:ft.index('\n}\n')]
BW, BH = (float(v) for v in re.search(r"'flood_base', 0, [\d.]+, 0, ([\d.]+), ([\d.]+),", ft).groups())
RT, RB = (float(v) for v in re.search(r"'flood_mast', 0, [^,]+, 0, ([\d.]+), M - [\d.]+, ([\d.]+),", ft).groups())
HW, HH, HD = (float(v) for v in re.search(r"'flood_head', lx, [\d.]+, [\d.]+, ([\d.]+), ([\d.]+), ([\d.]+),", ft).groups())
OCHRE, GUN, CAMO = palette(ROOT, 'hazardOchre'), palette(ROOT, 'gunmetal'), palette(ROOT, 'camoBlack')
RUST, MUD, SODIUM = palette(ROOT, 'rust'), palette(ROOT, 'mud'), palette(ROOT, 'sodium')
NZ = Noise(20261003)


def cyl_polys(face, rects, y0, y1, r0, r1, seg, grp, s_len, t0=0.0, t1=None, cx=0.0, cz=0.0, a0=0.0):
    """The side of a (tapered) cylinder about +y at (cx, cz): seg quads mapped to face (s around 0..s_len, t = y - y0 +
    t0), outward, not mirrored."""
    t1 = t0 + (y1 - y0) if t1 is None else t1
    polys = []
    for j in range(seg):
        a, b = a0 + 2 * math.pi * j / seg, a0 + 2 * math.pi * (j + 1) / seg
        p = lambda r, ang, y: np.array([cx + r * math.sin(ang), y, cz + r * math.cos(ang)])
        # s runs with the angle (from +z toward +x), t up: (d/d angle) x up = outward, so the quad a -> b -> up is CCW
        q = [p(r0, a, y0), p(r0, b, y0), p(r1, b, y1), p(r1, a, y1)]
        s_a, s_b = s_len * j / seg, s_len * (j + 1) / seg
        st = [(s_a, t0), (s_b, t0), (s_b, t1), (s_a, t1)]
        polys.append((q, [face_uv(rects[face['id']], face, s, t, ATLAS) for s, t in st], grp))
    return polys


def disc_polys(face, rects, y, r, seg, up=True, cx=0.0, cz=0.0):
    """A flat seg-gon cap (fan of triangles) at height y, mapped planar into face (x -> s, -z -> t)."""
    pts = [np.array([cx + r * math.sin(2 * math.pi * j / seg), y, cz + r * math.cos(2 * math.pi * j / seg)]) for j in range(seg)]
    uv = lambda v: face_uv(rects[face['id']], face, (v[0] - cx + r) / (2 * r) * face['w'], (cz - v[2] + r) / (2 * r) * face['h'], ATLAS)
    polys = []
    for j in range(1, seg - 1):
        tri = [pts[0], pts[j], pts[j + 1]]
        if (np.cross(tri[1] - tri[0], tri[2] - tri[0])[1] > 0) != up:
            tri = tri[::-1]
        polys.append((tri, [uv(v) for v in tri], None))
    return polys


# ================================================================================================ the mast
MAST_NAME = 'Kit_Lot_FloodMast_01'
MY0, MY1 = BH, MAST                                  # the mast from the base top (1.2) to the bar (22)
FL_R, FL_T = 0.72, 0.06                              # base flange
M_SEG = 16


def mast_colliders():
    return [('flood_base', (0, BH / 2, 0), (BW, BH, BW)),
            ('flood_mast', (0, MY0 + (MY1 - MY0) / 2, 0), (2 * max(RT, RB), MY1 - MY0, 2 * max(RT, RB)), None,
             {'sim_shape': 'cyl', 'sim_r': max(RT, RB), 'sim_hh': (MY1 - MY0) / 2})]


def mast_parts():
    ALL = ('+x', '-x', '+y', '-y', '+z', '-z')
    fk = lambda d: {k: d.get(k) for k in ALL}
    P = [('base', (0, BH / 2, 0), (BW, BH, BW), fk({'+x': 'ochre', '-x': 'ochre', '+z': 'ochre', '-z': 'ochre', '+y': 'ochretop'}), 0.12, (0, 1, 2)),
         ('plate', (0, BH + 0.015, 0), (BW - 0.6, 0.03, BW - 0.6), fk({'+y': 'checker', '+x': 'steel', '-x': 'steel', '+z': 'steel', '-z': 'steel'}), 0.0, (0, 1))]
    for s in (-1, 1):
        o = '+x' if s > 0 else '-x'
        P.append((f'pocket{s:+d}', (s * (BW / 2 + 0.02), 0.6, 0), (0.04, 0.5, BW - 0.6), fk({o: 'pocket', '+y': 'steel', '-y': 'steel', '+z': 'steel', '-z': 'steel'}), 0.0, (0, 1)))
    # the junction box on the mast (-z side, facing the base's -z edge), its door and gland
    P.append(('jbox', (0, MY0 + 1.3, -(RB + 0.12)), (0.42, 0.6, 0.22), fk({'-z': 'jbox', '+x': 'steel', '-x': 'steel', '+y': 'steel', '-y': 'steel'}), 0.0, (0, 1)))
    # step bolts up the mast (alternating +-x), a collar under the head
    for k in range(18):
        y = MY0 + 2.4 + k * 1.05
        r = RB + (RT - RB) * (y - MY0) / (MY1 - MY0)
        s = 1 if k % 2 == 0 else -1
        P.append((f'bolt{k}', (s * (r + 0.13), y, 0), (0.28, 0.05, 0.05), fk({'+y': 'bolt', '-y': 'bolt', '+z': 'bolt', '-z': 'bolt', ('+x' if s > 0 else '-x'): 'bolt'}), 0.0, (0,)))
    # gussets: 4 thin plates from the flange up the mast foot
    for k, (gx, gz) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        sz = (0.36, 0.5, 0.04) if gx else (0.04, 0.5, 0.36)
        P.append((f'gusset{k}', (gx * (RB + 0.18), MY0 + FL_T + 0.25, gz * (RB + 0.18)), sz, fk({'+x': 'steel', '-x': 'steel', '+z': 'steel', '-z': 'steel', '+y': 'steel'}), 0.0, (0,)))
    return P


MAST_DENSITY = {'ochre': 1.0, 'ochretop': 1.0, 'checker': 1.0, 'steel': 0.7, 'pocket': 0.9, 'jbox': 1.0, 'bolt': 0.5,
                'mast': 0.75, 'flange': 0.8, 'conduit': 0.4, 'cap': 0.6}


def mast_faces(P):
    F = []
    for k, (pid, c, size, kinds, ch, lods) in enumerate(P):
        F += box_faces(pid, size, kinds, seed=k)
    for k in range(2):                                   # the mast in two 10.4 m halves (packs twice as dense)
        F.append(dict(id=f'mast{k}', kind='mast', w=2 * math.pi * RB, h=(MY1 - MY0) / 2, t0=k * (MY1 - MY0) / 2, seed=50))
    F.append(dict(id='flange', kind='flange', w=2 * FL_R, h=2 * FL_R, seed=51))
    F.append(dict(id='flangeside', kind='steel', w=2 * math.pi * FL_R, h=FL_T, seed=52))
    F.append(dict(id='conduit', kind='conduit', w=2 * math.pi * 0.05, h=MY1 - MY0 - 1.9, seed=53))
    F.append(dict(id='collar', kind='steel', w=2 * math.pi * (RT + 0.06), h=0.25, seed=54))
    F.append(dict(id='cap', kind='cap', w=2 * (RT + 0.06), h=2 * (RT + 0.06), seed=55))
    return F


def mast_lod(lod, mat, rects, F, P):
    polys = []
    for pid, c, size, kinds, ch, lods in P:
        if lod in lods:
            polys += box_polys(pid, c, size, kinds, rects, ATLAS, F, ch=ch if lod == 0 else 0.0)
    seg = (16, 10, 6)[lod]
    ym = (MY0 + MY1) / 2
    rm = (RB + RT) / 2
    polys += cyl_polys(F['mast0'], rects, MY0, ym, RB, rm, seg, 'm', F['mast0']['w'])
    polys += cyl_polys(F['mast1'], rects, ym, MY1, rm, RT, seg, 'm', F['mast1']['w'])
    if lod < 2:
        polys += cyl_polys(F['flangeside'], rects, MY0, MY0 + FL_T, FL_R, FL_R, seg, None, F['flangeside']['w'])
        polys += disc_polys(F['flange'], rects, MY0 + FL_T, FL_R, seg)
    if lod == 0:
        rc = RT + 0.06
        polys += cyl_polys(F['collar'], rects, MY1 - 0.55, MY1 - 0.3, rc, rc, seg, None, F['collar']['w'])
        polys += disc_polys(F['cap'], rects, MY1 - 0.3, rc, seg)
        polys += disc_polys(F['cap'], rects, MY1 - 0.55, rc, seg, up=False)
        # the conduit: from the junction box's top up the mast's -z side to the collar
        y0c, y1c = MY0 + 1.6, MY1 - 0.55
        r0c, r1c = RB + (RT - RB) * (y0c - MY0) / (MY1 - MY0), RB + (RT - RB) * (y1c - MY0) / (MY1 - MY0)
        # a straight 6-sided tube leaning with the taper (its axis stays 7 cm off the mast)
        for j in range(6):
            a, b = 2 * math.pi * j / 6, 2 * math.pi * (j + 1) / 6
            p = lambda ang, y, rm: np.array([0.05 * math.sin(ang), y, -(rm + 0.07) + 0.05 * math.cos(ang)])
            q = [p(a, y0c, r0c), p(b, y0c, r0c), p(b, y1c, r1c), p(a, y1c, r1c)]
            f = F['conduit']
            st = [(f['w'] * j / 6, 0), (f['w'] * (j + 1) / 6, 0), (f['w'] * (j + 1) / 6, f['h']), (f['w'] * j / 6, f['h'])]
            polys.append((q, [face_uv(rects['conduit'], f, s, t, ATLAS) for s, t in st], 'c'))
    return poly_mesh(f'{MAST_NAME}_LOD{lod}', polys, mat)


def paint_steel(S, T, seed, base, wear=1.0):
    """Painted steel: the palette paint, weathered: chips to rusty steel on the edges and low, rust run-off, grime."""
    n1 = NZ.fbm(S * 1.3 + seed * 3, T * 1.3 - seed, 4)
    n2 = NZ.fbm(S * 6 + seed, T * 6, 3)
    c = base * (0.9 + 0.16 * n1)[..., None]
    chips = sstep(0.68, 0.74, NZ.fbm(S * 9 + seed, T * 9 - seed, 3)) * wear
    c = mix(c, RUST * (0.7 + 0.4 * n2)[..., None], chips)
    rough = 0.55 + 0.1 * (n2 - 0.5) + 0.3 * chips
    metal = 0.05 + 0.4 * chips
    hgt = 0.0004 * (n2 - 0.5) - 0.0008 * chips
    return c, rough, metal, hgt


def mast_paint(f, S, T):
    kind, seed = f['kind'], f.get('seed', 0)
    zero = np.zeros_like(S)
    if kind in ('ochre', 'ochretop'):
        c, rough, metal, hgt = paint_steel(S, T, seed, OCHRE, 0.7)
        if kind == 'ochre':
            y = T
            # a stencilled hazard chevron band along the top, rust streaks down from the top edge, mud at the foot
            chev = (np.mod((S + y) / 0.5, 1.0) < 0.5) * sstep(0.02, 0.0, np.abs(y - (BH - 0.14)) - 0.08)
            c = mix(c, CAMO, chev * 0.85)
            streak = sstep(0.6, 0.75, NZ.fbm(S * 7 + seed, 0.4, 2)) * sstep(BH, BH * 0.3, y) * sstep(0.2, 0.6, NZ.fbm(S * 3, y * 2 + seed, 2))
            c = mix(c, RUST * 0.8, streak * 0.6)
            low = sstep(0.45, 0.0, y + 0.1 * (NZ.fbm(S * 2, y * 2, 2) - 0.5))
            c = mix(c, MUD, low * 0.75)
            c = mix(c, c * 0.75, sstep(0.9, 0.2, y) * 0.4)
            # stencil ID block (the tower number) on each side
            glyph = (sstep(0.02, 0.0, np.abs(y - 0.55) - 0.12) * sstep(0.02, 0.0, np.abs(S - 0.7) - 0.4)
                     * (np.mod(S / 0.1, 1.0) < 0.72) * (NZ.v(np.floor(S / 0.1) * 2.7 + seed, 1.0) > 0.3))
            c = mix(c, CAMO, glyph * 0.8)
            rough = rough + 0.2 * low
        else:
            dirt = sstep(0.5, 0.75, NZ.fbm(S * 2 + 5, T * 2, 3))
            c = mix(c, c * 0.6, dirt * 0.6)
        return c, rough, metal, hgt, zero
    if kind == 'checker':
        c, rough, metal, hgt = paint_steel(S, T, seed, GUN * 0.9, 1.3)
        lug = ((np.mod(S / 0.1, 1.0) - 0.5) ** 2 + (np.mod(T / 0.1, 1.0) - 0.5) ** 2) < 0.06
        c = mix(c, c * 1.35, lug * 0.6)
        return c, rough - 0.1 * lug, metal + 0.2 * lug, hgt + 0.0015 * lug, zero
    if kind in ('steel', 'pocket', 'bolt', 'flange', 'cap', 'conduit'):
        base = CAMO if kind == 'pocket' else GUN
        c, rough, metal, hgt = paint_steel(S, T, seed, base, 1.2 if kind in ('bolt', 'flange') else 0.9)
        if kind == 'pocket':
            slot = sstep(0.02, 0.0, np.abs(T - 0.25) - 0.12) * sstep(0.02, 0.0, np.abs(np.abs(S - f['w'] / 2) - 0.7) - 0.3)
            c = mix(c, col(0.03, 0.03, 0.03), slot)
            hgt = hgt - 0.01 * slot
        return c, rough, metal, hgt, zero
    if kind == 'jbox':
        c, rough, metal, hgt = paint_steel(S, T, seed, col(0.5, 0.5, 0.47), 0.8)
        seam = sstep(0.012, 0.0, np.minimum(np.abs(S - 0.04), np.abs(S - (f['w'] - 0.04))) ) + sstep(0.012, 0.0, np.minimum(np.abs(T - 0.04), np.abs(T - (f['h'] - 0.04))))
        c = mix(c, c * 0.4, np.clip(seam, 0, 1))
        warn = sstep(0.01, 0.0, np.abs(S - f['w'] / 2) + np.abs(T - f['h'] * 0.62) * 1.2 - 0.09)
        c = mix(c, col(0.9, 0.75, 0.1), warn)
        return c, rough, metal, hgt - 0.002 * np.clip(seam, 0, 1), zero
    # the mast: gunmetal paint weathering upward; rust run-off from the step bolts, grime and splash low down
    c, rough, metal, hgt = paint_steel(S, T, seed, GUN, 0.8)
    y = T + f.get('t0', 0.0)
    seam = sstep(0.015, 0.0, np.abs(np.mod(y, 5.2) - 2.6) - 2.585)          # the mast's welded section joints
    c = mix(c, c * 0.6, seam)
    run = sstep(0.62, 0.72, NZ.fbm(S * 5 + seed, y * 0.25, 2)) * (0.5 + 0.5 * NZ.fbm(S * 2, y * 0.8, 2))
    c = mix(c, RUST * 0.75, run * 0.55)
    low = sstep(1.2, 0.0, y)
    c = mix(c, MUD * 1.2, low * 0.6)
    band = sstep(0.03, 0.0, np.abs(y - 2.2) - 0.25)                          # a reflective ochre band at eye height
    c = mix(c, OCHRE, band * 0.9)
    return c, rough + 0.1 * low - 0.1 * band, metal, hgt - 0.002 * seam, zero


# ================================================================================================ the lamp
LAMP_NAME = 'Kit_Lot_FloodLamp_01'
PROUD = 0.14                                         # visor / blinders ahead of the face, fins behind it (m)


def lamp_colliders():
    return [('flood_head', (0, HH / 2, 0), (HW, HH, HD))]


def lamp_parts():
    ALL = ('+x', '-x', '+y', '-y', '+z', '-z')
    fk = lambda d: {k: d.get(k) for k in ALL}
    hz = HD / 2
    P = [('body', (0, HH / 2, 0), (HW, HH, HD), fk({'+x': 'housing', '-x': 'housing', '+y': 'housetop', '-y': 'housing', '-z': 'back', '+z': 'front'}), 0.06, (0, 1, 2)),
         ('visor', (0, HH - 0.015, hz + PROUD / 2), (HW + 0.06, 0.03, PROUD), fk({'+y': 'housetop', '-y': 'visorin', '+z': 'housing', '+x': 'housing', '-x': 'housing'}), 0.0, (0, 1))]
    for s in (-1, 1):
        P.append((f'blind{s:+d}', (s * (HW / 2 + 0.015), HH / 2, hz + PROUD / 2), (0.03, HH - 0.03, PROUD), fk({'+x': 'housing', '-x': 'housing', '+z': 'housing'}), 0.0, (0, 1)))
        P.append((f'boss{s:+d}', (s * (HW / 2 + 0.03), HH / 2, 0), (0.06, 0.2, 0.2), fk({('+x' if s > 0 else '-x'): 'boss', '+y': 'boss', '-y': 'boss', '+z': 'boss', '-z': 'boss'}), 0.0, (0,)))
    for k in range(5):
        P.append((f'fin{k}', (-0.48 + 0.24 * k, HH / 2 + 0.02, -hz - 0.05), (0.03, HH - 0.2, 0.1), fk({'+x': 'fin', '-x': 'fin', '-z': 'fin', '+y': 'fin', '-y': 'fin'}), 0.0, (0,)))
    P.append(('gland', (0.35, 0.16, -hz - 0.04), (0.12, 0.12, 0.08), fk({'-z': 'boss', '+x': 'boss', '-x': 'boss', '+y': 'boss', '-y': 'boss'}), 0.0, (0,)))
    return P


LAMP_DENSITY = {'housing': 1.0, 'housetop': 1.0, 'back': 0.8, 'front': 1.2, 'visorin': 0.6, 'boss': 0.6, 'fin': 0.6}


def lamp_paint(f, S, T):
    kind, seed = f['kind'], f.get('seed', 0)
    zero = np.zeros_like(S)
    if kind == 'front':
        # bezel (camo-black paint) around a recessed reflector: faceted polished aluminium, warm with the sodium tube's
        # light (the tube itself is lamps-view's glow()), soot above the tube's line
        b = 0.09
        inner = (S > b) & (S < f['w'] - b) & (T > b) & (T < f['h'] - b)
        c, rough, metal, hgt = paint_steel(S * 2.5, T * 2.5, seed, CAMO, 0.3)
        facet = np.abs(np.mod((T - b) / 0.08, 1.0) - 0.5)
        refl = col(0.78, 0.76, 0.72) * (0.8 + 0.3 * facet)[..., None]
        refl = mix(refl, SODIUM * 0.9, 0.25)
        soot = sstep(0.1, 0.35, T / f['h']) * sstep(0.55, 0.75, NZ.fbm(S * 6, T * 6 + seed, 2))
        refl = mix(refl, col(0.2, 0.18, 0.16), soot * 0.25)
        c = np.where(inner[..., None], refl, c)
        rough = np.where(inner, 0.18 + 0.1 * soot, rough)
        metal = np.where(inner, 0.95, metal)
        rim = sstep(0.015, 0.0, np.abs(np.minimum(np.minimum(S, f['w'] - S), np.minimum(T, f['h'] - T)) - b))
        hgt = np.where(inner, -0.012 + 0.002 * facet, hgt) - 0.004 * rim
        c = mix(c, c * 0.5, rim)
        return c, rough, metal, hgt, zero
    base = CAMO
    c, rough, metal, hgt = paint_steel(S * 2.5, T * 2.5, seed, base, 0.5 if kind in ('boss', 'fin') else 0.3)
    if kind in ('housetop', 'visorin'):
        guano = sstep(0.74, 0.8, NZ.fbm(S * 14 + seed, T * 14, 3))
        c = mix(c, col(0.72, 0.71, 0.66), guano * 0.6 * (kind == 'housetop'))
        rough = rough + 0.2 * guano
    if kind in ('housing', 'back'):
        streak = sstep(0.6, 0.72, NZ.fbm(S * 8 + seed, 0.7, 2)) * sstep(0.2, 0.9, T / max(f['h'], 1e-3))
        c = mix(c, RUST * 0.7, streak * 0.45)
    return c, rough, metal, hgt, zero


# ================================================================================================ build
def build_piece(name, P, extra_faces, density, paint, lod_fn, colliders, ao_distance):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    faces = []
    for k, (pid, c, size, kinds, ch, lods) in enumerate(P):
        faces += box_faces(pid, size, kinds, seed=k)
    faces += extra_faces
    px_m, rects = solve_atlas(faces, ATLAS, PAD, density)
    F = {f['id']: f for f in faces}
    print(f'{name} atlas: {len(faces)} faces, {px_m} px/m')
    alb, rough, metal, nrm, _ = paint_faces(faces, rects, paint, ATLAS, PAD, GUN, 0.6)
    info = build_kit(name, lambda mat: [lod_fn(i, mat, rects, F, P) for i in range(3)], colliders, alb, rough, metal, nrm,
                     args.out, ATLAS, samples=args.samples, ao_distance=ao_distance, ao_floor=0.25, ao_into_albedo=0.25, pad=PAD)
    info.update(px_per_m=px_m)
    report(info, ROOT)


def lamp_lod(lod, mat, rects, F, P):
    polys = []
    for pid, c, size, kinds, ch, lods in P:
        if lod in lods:
            polys += box_polys(pid, c, size, kinds, rects, ATLAS, F, ch=ch if lod == 0 else 0.0)
    return poly_mesh(f'{LAMP_NAME}_LOD{lod}', polys, mat)


def main():
    MP = mast_parts()
    mf = [f for f in mast_faces(MP) if f['id'] in ('mast0', 'mast1', 'flange', 'flangeside', 'conduit', 'collar', 'cap')]
    build_piece(MAST_NAME, MP, mf, MAST_DENSITY, mast_paint, mast_lod, mast_colliders(), 2.0)
    build_piece(LAMP_NAME, lamp_parts(), [], LAMP_DENSITY, lamp_paint, lamp_lod, lamp_colliders(), 0.6)


main()

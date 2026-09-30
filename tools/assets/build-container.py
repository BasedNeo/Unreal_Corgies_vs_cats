# build-container.py (W11 P-GLB1): builds the master GLB of Kit_Lot_Container20_01, The Lot's 20 ft site-office
# container, with Blender 5 as a Python module (bpy 5.0.1 from PyPI, Python 3.11). The script is the source: it
# makes the geometry, the LODs, the COL_ proxies, the UV atlas, the textures and the GLB. No .blend is kept.
#
#   <venv>/bin/python tools/assets/build-container.py [--out assets/masters] [--samples 48]
#
# Output (assets/masters/): Kit_Lot_Container20_01.glb (PNG textures inside) and the three 1024^2 PNGs beside it:
#   _baseColor.png (sRGB), _orm.png (R occlusion, G roughness, B metalness), _normal.png (tangent space, OpenGL +Y).
#
# Standards (docs/design/ASSET_PIPELINE.md): metres; glTF +Y up (Blender +Z up, the exporter converts); the front
# faces +Z (the open end; long axis z like the world data); the pivot is the base centre on the ground.
# Size: the world's pet scale (x4): CONTAINER in src/shared/world/lot/layout.ts (24 x 9.6 x 10.4 m = a real 20 ft
# 6.06 x 2.44 x 2.59 m box x4), read from that file so the kit follows the world data. The side door is on +x, 7 m
# toward +z (c_west as built by props.ts container(); c_east is the same piece turned 180 degrees).
# COL_ boxes are the sim's colliders (props.ts container(): floor, roof, walls, lintel, door leaf, posts, headers)
# to the millimetre; tests/unit/glb-container-colliders.test.ts proves it against createWorldData('the_lot').
#
# Textures: every visible face gets its own rectangle in a 1024^2 atlas (shelf packing, a texel density per surface
# kind, 4 px gutters painted with the same function). baseColor / roughness / metalness / height are painted per
# texel by seeded numpy functions of the face's own metres (corrugation, paint, grime, run-off streaks, rust patches,
# chips, hazard band, plywood floor); the normal map comes from the height; the occlusion is BAKED by Cycles (AO,
# LOD0 on a ground plane) and multiplied lightly into the base colour as well. Determinism: fixed seeds, fixed
# Cycles seed/samples/threads, no denoiser; two runs give byte-identical files (the README records the hashes).
#
# W11 P-GLB1b: the shared half (noise, meshes, material, AO bake, COL_ boxes, export) moved to kitlib.py. The baseColor
# ALPHA is the PAINT MASK (1 = paint the game tints per instance; 0 = rust, grime, frame, door, glass, floor; stored as
# 1 + 254 x mask so no texel is fully transparent). Rust is now edge wear (the foot, the eaves under the rail, the
# corners at the posts, face borders of the frame) plus run-off streaks hanging from drip sources (the top rail, the
# window sills, the door head), strongest in the corrugation valleys, instead of isotropic patches.
import argparse
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import Noise, sstep, mix, col, g2b, make_mesh, build_kit, report  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NAME = 'Kit_Lot_Container20_01'
ATLAS = 1024
PAD = 4

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'masters'))
ap.add_argument('--samples', type=int, default=48)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

# ------------------------------------------------------------------------------------------------ world data
layout = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'layout.ts'), encoding='utf8').read()
m = re.search(r'export const CONTAINER = \{([^}]*)\}', layout)
C = {k: float(v) for k, v in re.findall(r'(\w+):\s*([-\d.]+)', m.group(1))}
m = re.search(r"id: 'c_west', x: ([-\d.]+), z: ([-\d.]+).*?door: \{ side: (-?1), z: ([-\d.]+) \}", layout)
assert m and int(m.group(3)) == 1, 'c_west must have its door on +x (side 1)'
DZ = float(m.group(4)) - float(m.group(2))            # the door's z offset from the container centre (7)
L, W, H, WALL, FLOOR, DOOR_W, DOOR_H = C['L'], C['W'], C['H'], C['wall'], C['floor'], C['doorW'], C['doorH']
HX, HZ = W / 2, L / 2


def colliders():
    """The sim's container colliders (props.ts container(), door side +1): (type, centre, size), game axes."""
    out = [('container_floor', (0, FLOOR / 2, 0), (W, FLOOR, L)),
           ('container_roof', (0, H - 0.2, 0), (W, 0.4, L))]
    wall_top = H - 0.4
    for s in (-1, 1):
        wx = s * (HX - WALL / 2)
        segs = [(-HZ, DZ - DOOR_W / 2), (DZ + DOOR_W / 2, HZ)] if s == 1 else [(-HZ, HZ)]
        for a, b in segs:
            out.append(('container_wall', (wx, wall_top / 2, (a + b) / 2), (WALL, wall_top, b - a)))
        if s == 1:
            out.append(('container_wall', (wx, (DOOR_H + wall_top) / 2, DZ), (WALL, wall_top - DOOR_H, DOOR_W)))
            leaf_z = DZ - math.copysign(1, DZ or 1) * (DOOR_W / 2 + 0.3 + (DOOR_W - 0.2) / 2)
            out.append(('container_door', (wx + s * 0.45, DOOR_H / 2 + 0.05, leaf_z), (0.3, DOOR_H - 0.2, DOOR_W - 0.2)))
    for sx in (-1, 1):
        for sz in (-1, 1):
            out.append(('container_post', (sx * (HX - 0.3), H / 2, sz * (HZ - 0.3)), (0.6, H, 0.6)))
    for sz in (-1, 1):
        out.append(('container_header', (0, H - 0.7, sz * (HZ - 0.3)), (W - 1.2, 0.6, 0.6)))
    return out


# ------------------------------------------------------------------------------------------------ visual parts
# A part is an axis-aligned box in game axes (x east, y up, z south = the kit's front). `faces` maps a face key
# ('+x', '-x', '+y', '-y', '+z', '-z') to a surface kind, or None to cull it (hidden against another part).
# `ch` is a chamfer (m, LOD0 only): the edges get a bevel strip that maps to the shared 'edge' texels (worn metal).
def part(name, c, size, faces, lods, ch=0.0):
    return dict(name=name, c=c, size=size, faces=faces, lods=set(lods), ch=ch)


def parts():
    P = []
    ALL = ('+x', '-x', '+y', '-y', '+z', '-z')
    fk = lambda d, default=None: {k: d.get(k, default) for k in ALL}
    P.append(part('floor', (0, FLOOR / 2, 0), (W, FLOOR, L), fk({'+y': 'floor', '+z': 'frame', '-z': 'frame'}), (0, 1, 2)))
    P.append(part('roof', (0, H - 0.2, 0), (W, 0.4, L), fk({'+y': 'roof', '-y': 'ceiling', '+z': 'frame', '-z': 'frame'}), (0, 1, 2)))
    wy0, wy1 = FLOOR, H - 0.4
    wc, wh = (wy0 + wy1) / 2, wy1 - wy0
    for s in (-1, 1):
        wx = s * (HX - WALL / 2)
        o, i = ('+x', '-x') if s == 1 else ('-x', '+x')
        if s == -1:
            P.append(part('wall_w', (wx, wc, 0), (WALL, wh, L), fk({o: 'corr_out', i: 'corr_in'}), (0, 1, 2)))
        else:
            a0, a1 = -HZ, DZ - DOOR_W / 2
            b0, b1 = DZ + DOOR_W / 2, HZ
            P.append(part('wall_e_a', (wx, wc, (a0 + a1) / 2), (WALL, wh, a1 - a0), fk({o: 'corr_out', i: 'corr_in', '+z': 'frame'}), (0, 1, 2)))
            P.append(part('wall_e_b', (wx, wc, (b0 + b1) / 2), (WALL, wh, b1 - b0), fk({o: 'corr_out', i: 'corr_in', '-z': 'frame'}), (0, 1, 2)))
            P.append(part('lintel', (wx, (DOOR_H + wy1) / 2, DZ), (WALL, wy1 - DOOR_H, DOOR_W), fk({o: 'corr_out', i: 'corr_in', '-y': 'frame'}), (0, 1, 2)))
            # door frame (proud of the outer face) and the leaf swung open toward the middle
            fx = HX + 0.06
            P.append(part('jamb_a', (fx, (FLOOR + DOOR_H + 0.3) / 2, DZ - DOOR_W / 2 - 0.15), (0.12, DOOR_H + 0.3 - FLOOR, 0.3), fk({'+x': 'frame', '+y': 'frame', '+z': 'frame', '-z': 'frame'}), (0, 1), ch=0.03))
            P.append(part('jamb_b', (fx, (FLOOR + DOOR_H + 0.3) / 2, DZ + DOOR_W / 2 + 0.15), (0.12, DOOR_H + 0.3 - FLOOR, 0.3), fk({'+x': 'frame', '+y': 'frame', '+z': 'frame', '-z': 'frame'}), (0, 1), ch=0.03))
            P.append(part('door_head', (fx, DOOR_H + 0.15, DZ), (0.12, 0.3, DOOR_W), fk({'+x': 'frame', '+y': 'frame', '-y': 'frame'}), (0, 1), ch=0.03))
            leaf_z = DZ - math.copysign(1, DZ or 1) * (DOOR_W / 2 + 0.3 + (DOOR_W - 0.2) / 2)
            lx = wx + 0.45
            P.append(part('door_leaf', (lx, DOOR_H / 2 + 0.05, leaf_z), (0.3, DOOR_H - 0.2, DOOR_W - 0.2),
                          fk({'+x': 'door', '-x': 'frame', '+y': 'frame', '-y': 'frame', '+z': 'frame', '-z': 'frame'}), (0, 1, 2), ch=0.04))
            for bz in (-0.85, 0.85):
                P.append(part('door_bar', (lx + 0.2, DOOR_H / 2 + 0.05, leaf_z + bz), (0.1, DOOR_H - 0.6, 0.1),
                              fk({'+x': 'bar', '+z': 'bar', '-z': 'bar', '+y': 'bar', '-y': 'bar'}), (0,)))
        # windows high on the wall (props.ts: z = +-6.5, skipped next to the door)
        for wz in (-6.5, 6.5):
            if s == 1 and abs(wz - DZ) < DOOR_W / 2 + 2:
                continue
            P.append(part('window', (s * (HX + 0.06), 6.6, wz), (0.12, 3.0, 4.2), fk({o: 'window', '+y': 'frame', '-y': 'frame', '+z': 'frame', '-z': 'frame'}), (0, 1, 2)))
        # side rails: the top one carries the hazard band (props.ts: hazardOchre along the eaves)
        rx = s * (HX + 0.08)
        rl = L - 2 * 0.66
        P.append(part('rail_top', (rx, H - 0.25, 0), (0.16, 0.5, rl), fk({o: 'hazard', '+y': 'frame', '-y': 'frame'}), (0, 1), ch=0.03))
        P.append(part('rail_bot', (rx, 0.225, 0), (0.16, 0.45, rl), fk({o: 'frame', '+y': 'frame'}), (0, 1), ch=0.03))
    for sx in (-1, 1):
        for sz in (-1, 1):
            px, pz = sx * (HX - 0.3), sz * (HZ - 0.3)
            ox, oz = ('+x' if sx > 0 else '-x'), ('+z' if sz > 0 else '-z')
            ix, iz = ('-x' if sx > 0 else '+x'), ('-z' if sz > 0 else '+z')
            P.append(part('post', (px, H / 2, pz), (0.7, H - 1.0, 0.7), fk({ox: 'frame', oz: 'frame', ix: 'frame', iz: 'frame'}), (0, 1, 2), ch=0.05))
            for cy in (0.28, H - 0.22):
                faces = fk({ox: 'casting', oz: 'casting', ix: 'frame', iz: 'frame', '+y': 'casting' if cy > 1 else 'frame', '-y': 'frame' if cy > 1 else None})
                P.append(part('casting', (px + sx * 0.02, cy, pz + sz * 0.02), (0.76, 0.56, 0.76), faces, (0, 1), ch=0.06))
    for sz in (-1, 1):
        o, i = ('+z', '-z') if sz > 0 else ('-z', '+z')
        P.append(part('header', (0, H - 0.7, sz * (HZ - 0.3)), (W - 1.3, 0.6, 0.7), fk({o: 'frame', i: 'frame', '-y': 'frame'}), (0, 1, 2), ch=0.04))
    for lz in (-5, 5):
        P.append(part('lamp_housing', (0, H - 0.72, lz), (0.5, 0.18, 3.6), fk({'-y': 'lamp', '+x': 'frame', '-x': 'frame', '+z': 'frame', '-z': 'frame'}), (0,)))
    return P


# ------------------------------------------------------------------------------------------------ face frames
AX = {'x': 0, 'y': 1, 'z': 2}


def face_frame(key):
    """(N, t, s) unit vectors of a face: t is 'up' in the texture, s = t x N (so s, t, N is right-handed)."""
    a, sign = AX[key[1]], 1 if key[0] == '+' else -1
    N = np.zeros(3); N[a] = sign
    if a == 1:
        t = np.array([0, 0, -1.0]) if sign > 0 else np.array([0, 0, 1.0])
    else:
        t = np.array([0, 1.0, 0])
    s = np.cross(t, N)
    return N, t, s


def face_rect(p, key):
    """Face extent in its (s, t) coords (absolute game metres): s0, s1, t0, t1."""
    c, size = np.array(p['c'], float), np.array(p['size'], float)
    N, t, s = face_frame(key)
    h = size / 2
    corners = [c + np.array([dx, dy, dz]) * h for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    corners = [q for q in corners if abs(np.dot(q - c, N) - np.dot(h, np.abs(N))) < 1e-9]
    ss, tt = [float(np.dot(q, s)) for q in corners], [float(np.dot(q, t)) for q in corners]
    return min(ss), max(ss), min(tt), max(tt)


# texel density weights per kind (the atlas scale is solved so everything fits 1024^2)
DENSITY = {'corr_out': 1.0, 'door': 1.1, 'hazard': 1.1, 'window': 1.1, 'frame': 1.0, 'casting': 1.2, 'bar': 0.8,
           'roof': 0.8, 'corr_in': 0.62, 'ceiling': 0.5, 'floor': 0.7, 'lamp': 0.6}


def pack(faces, scale):
    """Shelf-pack face rects (w, h px incl. gutters) at `scale` px/m x density. Returns placements or None."""
    items = []
    for f in faces:
        d = DENSITY[f['kind']] * scale
        w = max(4, int(math.ceil((f['s1'] - f['s0']) * d)))
        h = max(4, int(math.ceil((f['t1'] - f['t0']) * d)))
        rot = h > w                                   # landscape rects pack tighter: turn tall faces 90 degrees
        items.append((f, h, w, rot) if rot else (f, w, h, rot))
    items.sort(key=lambda it: (-it[2], -it[1], it[0]['id']))
    x = y = shelf = 0
    rects = {}
    for f, w, h, rot in items:
        W2, H2 = w + 2 * PAD, h + 2 * PAD
        if W2 > ATLAS:
            return None
        if x + W2 > ATLAS:
            x, y, shelf = 0, y + shelf, 0
        if y + H2 > ATLAS - EDGE_PX - 2 * PAD:
            return None
        rects[f['id']] = (x + PAD, y + PAD, w, h, rot)
        x += W2
        shelf = max(shelf, H2)
    return rects


EDGE_PX = 12   # the shared worn-edge texels (top-right corner block), used by every chamfer face


# ------------------------------------------------------------------------------------------------ painting
NZ = Noise(20260930)


PAINT = col(0.74, 0.72, 0.69)      # neutral light paint; the game tints each instance to its palette colour
GRIME = col(0.26, 0.22, 0.18)
MUD = col(0.23, 0.18, 0.13)
RUST = col(0.42, 0.20, 0.10)
RUST_DARK = col(0.24, 0.12, 0.07)
STEEL = col(0.50, 0.51, 0.52)
GUN = col(0.20, 0.21, 0.23)


def corrugation(u, pitch, amp):
    """Soft trapezoid profile (height, m) along u."""
    return amp * np.clip(1.7 * np.sin(2 * np.pi * u / pitch), -1, 1)


# Drip sources of the outer side walls: (s0, s1, t, strength) in the face's (S, T) metres. Water runs off the top rail,
# the window sills and the door head and leaves the rust / dirt run-off streaks hanging from them. On the +x face
# S = -z, on the -x face S = +z (face_frame: s = t x N with t = +y).
def drip_sources(key):
    if key not in ('+x', '-x'):
        return []
    sgn = -1 if key == '+x' else 1
    out = [(-HZ, HZ, H - 0.42, 1.0)]
    for wz in (-6.5, 6.5):
        if key == '+x' and abs(wz - DZ) < DOOR_W / 2 + 2:
            continue
        out.append((sgn * wz - 2.1, sgn * wz + 2.1, 6.6 - 1.5, 0.85))
    if key == '+x':
        out.append((sgn * DZ - DOOR_W / 2 - 0.3, sgn * DZ + DOOR_W / 2 + 0.3, DOOR_H, 0.9))
    return out


def runoff(S, T, sources, seed, valley, thin=True):
    """Run-off streaks (0..1) hanging from drip sources: columns picked by 1D noise along S (thin, uneven widths), each
    with its own length (mostly short, a few long), thinning and breaking up as they run down; stronger in the
    corrugation valleys, where the water runs."""
    out = np.zeros_like(S)
    if not sources:
        return out
    f = 4.2 if thin else 1.6
    colsel = np.maximum(NZ.fbm(S * f + seed * 3.1, 7.5 + seed * 0.37, 3), 0.92 * NZ.fbm(S * f * 2.3 - seed, 19.1, 2))
    length = 0.7 + 5.0 * NZ.v(S * 0.8 + 11.0 + seed, 3.0 + seed * 0.1) ** 2
    brk = sstep(0.25, 0.6, NZ.fbm(S * 7.0 + seed, T * 0.6 + 2.0, 3))
    for s0, s1, t, k in sources:
        inside = sstep(s0 - 0.05, s0 + 0.25, S) * sstep(s1 + 0.05, s1 - 0.25, S)
        d = t - T
        run = np.clip(d, 0, None) / length                               # 0 at the source, 1 at the streak's length
        width = sstep(0.58 + 0.1 * np.clip(run, 0, 1), 0.66 + 0.1 * np.clip(run, 0, 1), colsel)
        fade = np.exp(-run) * sstep(-0.06, 0.02, d)
        out = np.maximum(out, width * fade * inside * k * (0.45 + 0.55 * np.maximum(brk, sstep(0.6, 0.0, run))))
    return np.clip(out * (0.55 + 0.45 * valley), 0, 1)


def paint(kind, S, T, u01, v01, seed, key='+x', dims=(1.0, 1.0)):
    """Albedo (sRGB), roughness, metalness, height (m) and PAINT MASK (0..1) of one face's texels. S, T are absolute
    face metres; `key` the face's side ('+x' ...); dims its (width, height) in metres."""
    n1 = NZ.fbm(S * 0.28 + seed, T * 0.28 - seed)
    n2 = NZ.fbm(S * 1.1 - seed * 0.7, T * 1.1 + 9.1)
    n3 = NZ.fbm(S * 4.3 + 3.3, T * 4.3 + seed * 0.3, 3)
    zero = np.zeros_like(S)
    # distance to the face border (m): edge wear lives there
    ed = np.minimum(np.minimum(u01, 1 - u01) * dims[0], np.minimum(v01, 1 - v01) * dims[1])
    rustc = lambda: mix(RUST, RUST_DARK, sstep(0.3, 0.75, n3))
    if kind in ('corr_out', 'corr_in', 'roof', 'ceiling'):
        inner = kind in ('corr_in', 'ceiling')
        roofish = kind in ('roof', 'ceiling')
        amp = 0.05 if roofish else 0.13
        h = corrugation(T, 1.2, amp) if roofish else corrugation(S, L / 21, amp)   # 21 side ribs over 24 m
        valley = sstep(0.02, -0.08, h / amp)
        crest = sstep(0.35, 0.95, h / amp)
        base = PAINT * (0.9 + 0.16 * n1)[..., None]
        if not inner:
            base = mix(base, base * 1.07 + 0.02, sstep(6.5, 10.0, T) * 0.5)      # sun-faded upper wall
        src = drip_sources(key) if kind == 'corr_out' else []
        dirt_run = runoff(S, T, src, seed + 1.7, valley, thin=False)             # broad dirty run-off
        rust_run = runoff(S, T, src, seed, valley, thin=True)                    # thin rust streaks
        grime = sstep(2.4, 0.3, T + 1.2 * (n2 - 0.5)) * (0.75 if not inner else 0.9)   # the dirt band at the foot
        grime = np.maximum(grime, dirt_run * 0.55)
        if kind == 'roof':
            stains = sstep(0.5, 0.75, NZ.fbm(S * 0.45 + 2.0, T * 0.45 - 5.0))
            grime = np.maximum(0.25 + 0.2 * valley, stains * 0.75)
        if inner:
            grime = np.maximum(grime, 0.35 + 0.15 * n2)
        # edge wear (rust): the foot (rising up the valleys), the eaves under the rail, the corners at the posts
        brk = 0.4 * (n3 - 0.5) + 0.3 * (n2 - 0.5)
        if roofish:
            e = np.maximum(sstep(HX - 0.9, HX - 0.1, np.abs(S)), sstep(HZ - 0.9, HZ - 0.1, np.abs(T))) + 0.25 * valley
        else:
            vs = 0.5 - 0.5 * np.sin(2 * np.pi * S / (L / 21))                  # 1 in a valley (smooth, for the rise)
            rise = (0.1 + 0.5 * NZ.v(np.floor(S / (L / 21)) * 5.3 + seed, 1.7)) * vs   # rust climbs the valleys unevenly
            e = np.maximum.reduce([sstep(1.2, 0.3, T - rise - 0.6 * (n1 - 0.5)), sstep(H - 0.85, H - 0.45, T) * 0.75,
                                   sstep(HZ - 0.9, HZ - 0.1, np.abs(S)) * 0.85])
        rust_e = sstep(0.5, 0.66, e + brk) * (0.5 if inner else 1.0)
        # scrapes (bare metal, part rusted): horizontal marks at knock height, stretched noise
        scrape = sstep(0.8, 0.86, NZ.fbm(S * 0.3 + seed, T * 7.0 + 3.0, 3)) * sstep(3.8, 1.2, T) * (0 if roofish else 1)
        knock = 0.3 + 0.7 * sstep(3.5, 0.8, T) if not roofish else 0.5          # chips: mostly low on the wall, crests, edges
        chips = sstep(0.87, 0.9, n3 + 0.28 * (n2 - 0.5) + 0.08 * crest + 0.2 * sstep(0.25, 0.0, ed)) * knock * (1 - rust_e)
        steel_hit = np.maximum(scrape, chips)
        c = mix(base, GRIME * (0.9 + 0.2 * n3)[..., None], grime * 0.72)
        c = mix(c, RUST * 1.12, rust_run * 0.62)
        c = mix(c, rustc(), rust_e)
        bare = mix(STEEL * (0.8 + 0.3 * n3)[..., None], RUST * 0.9, sstep(0.4, 0.7, n2))
        c = mix(c, bare, steel_hit * 0.8)
        if inner:
            c = c * 0.78
        mask = (1 - grime * 0.72) * (1 - rust_run * 0.62) * (1 - rust_e) * (1 - steel_hit * 0.8)
        rough = 0.5 + 0.22 * grime + 0.33 * rust_e + 0.15 * rust_run - 0.12 * steel_hit + 0.06 * (n3 - 0.5)
        metal = steel_hit * 0.7 * (1 - sstep(0.4, 0.7, n2))
        h = h + 0.01 * (n2 - 0.5) - 0.006 * rust_e * n3 - 0.002 * scrape
        return c, rough, metal, h, mask
    if kind == 'floor':
        plank = np.floor(S / 1.2)
        tint = NZ.v(plank * 3.7, plank * 1.3 + 0.5)
        grain = NZ.fbm(S * 6.0 + plank * 13, T * 0.25, 3)
        seam = sstep(0.035, 0.0, np.minimum(np.mod(S, 1.2), 1.2 - np.mod(S, 1.2)))
        base = col(0.36, 0.25, 0.16) * (0.8 + 0.35 * tint + 0.25 * (grain - 0.5))[..., None]
        dirt = np.maximum(sstep(HZ - 4.0, HZ, np.abs(T)) * 0.8, sstep(0.55, 0.8, n2) * 0.6)
        scuff = sstep(0.7, 0.8, NZ.fbm(S * 1.8, T * 0.6 + 7.0)) * 0.4
        c = mix(base, MUD, dirt * 0.8)
        c = mix(c, base * 1.35, scuff)
        c = mix(c, col(0.08, 0.06, 0.05), seam)
        return c, 0.82 - 0.1 * scuff + 0.08 * dirt, zero, -0.02 * seam, zero
    if kind in ('frame', 'casting', 'bar', 'lamp'):
        if kind == 'bar':
            base, rough0, metal0 = STEEL * 1.1, 0.38, 0.9
        elif kind == 'lamp':
            base, rough0, metal0 = col(0.78, 0.78, 0.76), 0.45, 0.0
        else:
            base, rough0, metal0 = GUN * (0.85 if kind == 'casting' else 1.0), 0.5, 0.25
        base = base * (0.88 + 0.24 * n1)[..., None]
        # edge wear at the face borders, rust at the foot, streaks hanging from the top of vertical faces
        brk = 0.4 * (n3 - 0.5) + 0.25 * (n2 - 0.5)
        vertical = key[1] != 'y'
        e = np.maximum(sstep(0.07, 0.0, ed) * 0.85, sstep(1.2, 0.2, T) * (0.9 if vertical else 0.0))
        rust_e = sstep(0.58, 0.72, e + brk + (0.1 if kind == 'casting' else 0.0))
        run = runoff(S, T, [(-1e3, 1e3, T.max() + 0.01, 0.8)], seed, np.ones_like(S)) if vertical and dims[1] > 1.5 else zero
        grime = sstep(1.6, 0.2, T) * 0.6
        c = mix(base, GRIME, grime * 0.6)
        k = 0 if kind == 'lamp' else 1
        c = mix(c, RUST * 1.05, run * 0.55 * k)
        c = mix(c, rustc(), rust_e * k)
        h = 0.004 * (n2 - 0.5) - 0.003 * rust_e * n3
        if kind == 'casting':
            hole = ((u01 - 0.5) / 0.3) ** 2 + ((v01 - 0.5) / 0.2) ** 2 < 1.0
            c = np.where(hole[..., None], col(0.03, 0.03, 0.03), c)
            h = np.where(hole, -0.05, h)
        rk = np.maximum(rust_e, run * 0.5) * k
        return c, rough0 + 0.3 * rk + 0.15 * grime, metal0 * (1 - rk), h, zero
    if kind == 'door':
        h = corrugation(S, 0.62, 0.05)
        valley = sstep(0.01, -0.03, h / 0.05)
        base = col(0.49, 0.52, 0.55) * (0.88 + 0.22 * n1)[..., None]
        brk = 0.4 * (n3 - 0.5) + 0.3 * (n2 - 0.5)
        rust_e = sstep(0.5, 0.66, np.maximum(sstep(1.3, 0.3, T - 0.4 * valley), sstep(0.2, 0.0, ed)) + brk)
        run = runoff(S, T, [(-1e3, 1e3, T.max() - 0.05, 0.9)], seed, valley)
        grime = np.maximum(sstep(2.0, 0.4, T) * 0.7, runoff(S, T, [(-1e3, 1e3, T.max() - 0.05, 1.0)], seed + 2.2, valley, thin=False) * 0.45)
        c = mix(base, GRIME, grime * 0.7)
        c = mix(c, RUST * 1.1, run * 0.6)
        c = mix(c, rustc(), rust_e)
        return c, 0.45 + 0.25 * grime + 0.3 * rust_e + 0.12 * run, 0.35 * (1 - rust_e), h, zero
    if kind == 'hazard':
        stripe = np.mod((S + T) / 0.9, 1.0) < 0.5
        base = np.where(stripe[..., None], col(0.78, 0.56, 0.14), col(0.07, 0.07, 0.07))
        worn = sstep(0.62, 0.7, n3 + 0.2 * (n2 - 0.5) + 0.3 * sstep(0.08, 0.0, ed))
        c = mix(base * (0.85 + 0.2 * n1)[..., None], GUN, worn)
        c = mix(c, rustc(), sstep(0.62, 0.74, n2 + 0.3 * sstep(0.1, 0.0, ed)) * 0.8)
        return c, 0.55 + 0.2 * worn, 0.2 * worn, 0.003 * (n2 - 0.5), zero
    if kind == 'window':
        bw = 0.28
        us, vs = u01 * 4.2, v01 * 3.0            # the face's metres (4.2 x 3.0 m frame)
        frame = (us < bw) | (us > 4.2 - bw) | (vs < bw) | (vs > 3.0 - bw) | (np.abs(us - 2.1) < 0.07)
        trim = col(0.86, 0.84, 0.78) * (0.85 + 0.2 * n1)[..., None]
        trim = mix(trim, GRIME, sstep(0.55, 0.8, n2) * 0.5)
        trim = mix(trim, RUST, sstep(0.3, 0.0, vs) * sstep(0.45, 0.75, n3) * 0.7)   # the sill rusts
        glass = mix(col(0.07, 0.15, 0.18), col(0.2, 0.19, 0.16), sstep(0.8, 0.0, vs) * 0.6 + 0.15 * n2)
        c = np.where(frame[..., None], trim, glass)
        rough = np.where(frame, 0.5, 0.06 + 0.12 * sstep(0.9, 0.0, vs))
        h = np.where(frame, 0.01, 0.0)
        return c, rough, zero, h, zero
    raise ValueError(kind)


def paint_atlas(faces, rects):
    alb = np.zeros((ATLAS, ATLAS, 3)); alb[:] = GUN
    rough = np.full((ATLAS, ATLAS), 0.6)
    metal = np.zeros((ATLAS, ATLAS))
    mask = np.zeros((ATLAS, ATLAS))
    nrm = np.zeros((ATLAS, ATLAS, 3)); nrm[..., 2] = 1
    for f in faces:
        x, y, w, h, rot = rects[f['id']]
        ii = np.arange(-PAD, w + PAD) + 0.5
        jj = np.arange(-PAD, h + PAD) + 0.5
        Ui, Vj = np.meshgrid(ii, jj)                     # [row = v, col = u]
        if rot:                                          # u runs along t, v along -s (still right-handed with N)
            ku, kv = w / (f['t1'] - f['t0']), h / (f['s1'] - f['s0'])
            T = f['t0'] + Ui / ku
            S = f['s1'] - Vj / kv
        else:
            ku, kv = w / (f['s1'] - f['s0']), h / (f['t1'] - f['t0'])
            S = f['s0'] + Ui / ku
            T = f['t0'] + Vj / kv
        u01, v01 = (S - f['s0']) / (f['s1'] - f['s0']), (T - f['t0']) / (f['t1'] - f['t0'])
        c, r, mt, hgt, mk = paint(f['kind'], S, T, u01, v01, f['seed'], f['key'], (f['s1'] - f['s0'], f['t1'] - f['t0']))
        hgt = np.broadcast_to(hgt, S.shape)
        # tangent-space normal from the height, in the texel axes: n = (-dh/du, -dh/dv, 1) (metres along +u, +v)
        dhu = np.gradient(hgt, axis=1) * ku
        dhv = np.gradient(hgt, axis=0) * kv
        n = np.stack([-dhu, -dhv, np.ones_like(hgt)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        ys, xs = slice(y - PAD, y + h + PAD), slice(x - PAD, x + w + PAD)
        alb[ys, xs] = np.clip(c, 0, 1)
        rough[ys, xs] = np.clip(np.broadcast_to(r, S.shape), 0.04, 1)
        metal[ys, xs] = np.clip(np.broadcast_to(mt, S.shape), 0, 1)
        mask[ys, xs] = np.clip(np.broadcast_to(mk, S.shape), 0, 1)
        nrm[ys, xs] = n
    # the shared worn-edge block (chamfers): paint worn through to rusty steel, flat normal
    e = slice(ATLAS - EDGE_PX, ATLAS)
    alb[e, e] = col(0.36, 0.25, 0.18)
    rough[e, e] = 0.55
    metal[e, e] = 0.35
    mask[e, e] = 0.0
    nrm[e, e] = (0, 0, 1)
    return alb, rough, metal, nrm, mask


def box_polys(p, rects, lod):
    """Polygons of one part for one LOD: list of (verts in game axes, uvs, outward normal)."""
    c, size = np.array(p['c'], float), np.array(p['size'], float)
    h = size / 2
    ch = p['ch'] if lod == 0 else 0.0
    polys = []
    keys = ('+x', '-x', '+y', '-y', '+z', '-z')
    for key in keys:
        kind = p['faces'][key]
        if kind is None:
            continue
        N, t, s = face_frame(key)
        a = AX[key[1]]
        others = [k for k in range(3) if k != a]
        # face corners (inset by the chamfer along the two in-plane axes)
        ctr = c + N * h[a]
        q = []
        for d0, d1 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v = ctr.copy()
            v[others[0]] += d0 * (h[others[0]] - ch)
            v[others[1]] += d1 * (h[others[1]] - ch)
            q.append(v)
        fid = f"{p['id']}{key}"
        x, y, w, hh, rot = rects[fid]
        s0, s1, t0, t1 = p['rect'][key]
        if rot:
            uv = [((x + (np.dot(v, t) - t0) / (t1 - t0) * w) / ATLAS, (y + (s1 - np.dot(v, s)) / (s1 - s0) * hh) / ATLAS) for v in q]
        else:
            uv = [((x + (np.dot(v, s) - s0) / (s1 - s0) * w) / ATLAS, (y + (np.dot(v, t) - t0) / (t1 - t0) * hh) / ATLAS) for v in q]
        polys.append((q, uv, N))
    if ch > 0:
        # bevel strips along the 12 edges and the 8 corner triangles (only where both/all faces are kept)
        e0 = (ATLAS - EDGE_PX + 2) / ATLAS
        e1 = (ATLAS - 2) / ATLAS
        kept = {k for k in keys if p['faces'][k] is not None}
        for a in range(3):
            for b in range(a + 1, 3):
                third = 3 - a - b
                for sa in (-1, 1):
                    for sb in (-1, 1):
                        ka, kb = ('+' if sa > 0 else '-') + 'xyz'[a], ('+' if sb > 0 else '-') + 'xyz'[b]
                        if ka not in kept or kb not in kept:
                            continue
                        vs = []
                        for st in (-1, 1):
                            for which in (0, 1):
                                v = c.copy()
                                v[third] += st * (h[third] - ch)
                                v[a] += sa * (h[a] - (ch if which == 1 else 0))
                                v[b] += sb * (h[b] - (0 if which == 1 else ch))
                                vs.append(v)
                        quad = [vs[0], vs[1], vs[3], vs[2]]
                        n = np.zeros(3); n[a] = sa; n[b] = sb; n /= np.linalg.norm(n)
                        uv = [(e0, e0), (e1, e0), (e1, e1), (e0, e1)]
                        polys.append((quad, uv, n))
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    ks = [('+' if sx > 0 else '-') + 'x', ('+' if sy > 0 else '-') + 'y', ('+' if sz > 0 else '-') + 'z']
                    if not all(k in kept for k in ks):
                        continue
                    sg = np.array([sx, sy, sz], float)
                    tri = []
                    for a in range(3):
                        v = c + sg * (h - ch)
                        v[a] = c[a] + sg[a] * h[a]
                        tri.append(v)
                    n = sg / np.linalg.norm(sg)
                    polys.append((tri, [(e0, e0), (e1, e0), (e1, e1)], n))
    # windings: counter-clockwise seen from outside
    out = []
    for q, uv, n in polys:
        nn = np.cross(q[1] - q[0], q[2] - q[0])
        if np.dot(nn, n) < 0:
            q, uv = q[::-1], uv[::-1]
        out.append((q, uv))
    return out


# ------------------------------------------------------------------------------------------------ build
def main():
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0

    P = parts()
    for i, p in enumerate(P):
        p['id'] = f'{i:02d}_{p["name"]}'
        p['rect'] = {k: face_rect(p, k) for k in p['faces']}
    faces = []
    for p in P:
        for k, kind in p['faces'].items():
            if kind is None:
                continue
            s0, s1, t0, t1 = p['rect'][k]
            faces.append(dict(id=f"{p['id']}{k}", kind=kind, key=k, s0=s0, s1=s1, t0=t0, t1=t1, seed=(len(faces) * 7.31) % 97))
    lo, hi = 1.0, 200.0
    for _ in range(40):                         # the largest px/m that packs
        mid = (lo + hi) / 2
        if pack(faces, mid):
            lo = mid
        else:
            hi = mid
    scale = math.floor(lo * 100) / 100
    rects = pack(faces, scale)
    print(f'atlas: {len(faces)} faces, {scale:.2f} px/m (x density weight)')

    alb, rough, metal, nrm, mask = paint_atlas(faces, rects)
    print(f'paint mask: mean {mask.mean():.3f} (1 = tinted paint)')

    def lods(mat):
        out = []
        for lod in (0, 1, 2):
            polys = []
            for p in P:
                if lod in p['lods']:
                    polys += box_polys(p, rects, lod)
            out.append(make_mesh(f'{NAME}_LOD{lod}', polys, mat))
        return out

    def ao_fix(ao):
        e = slice(ATLAS - EDGE_PX, ATLAS)
        ao[e, e] = 1.0
        return ao

    info = build_kit(NAME, lods, colliders(), alb, rough, metal, nrm, args.out, ATLAS, samples=args.samples,
                     paint_mask=mask, ao_fix=ao_fix, pad=PAD)
    info.update(atlas_px_per_m=scale, faces=len(faces), colliders=len(colliders()))
    report(info, ROOT)

main()

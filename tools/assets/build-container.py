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
import argparse
import json
import math
import os
import re
import sys

import bpy
import numpy as np

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
class Noise:
    def __init__(self, seed):
        self.t = np.random.default_rng(seed).random((256, 256))

    def v(self, x, y):
        xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
        fx, fy = x - xi, y - yi
        u, w = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        T = self.t
        a, b = T[yi & 255, xi & 255], T[yi & 255, (xi + 1) & 255]
        c, d = T[(yi + 1) & 255, xi & 255], T[(yi + 1) & 255, (xi + 1) & 255]
        return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w

    def fbm(self, x, y, octaves=4):
        s, amp, norm = 0.0, 0.5, 0.0
        for o in range(octaves):
            s = s + self.v(x * (2 ** o) + 31.7 * o, y * (2 ** o) - 17.3 * o) * amp
            norm += amp
            amp *= 0.5
        return s / norm


NZ = Noise(20260930)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    a, b, t = np.asarray(a, float), np.asarray(b, float), np.asarray(t, float)
    rgb = lambda x: x.ndim in (1, 3) and x.shape[-1] == 3
    if t.ndim == 2 and (rgb(a) or rgb(b)):
        t = t[..., None]
    return a * (1 - t) + b * t


def col(*rgb):
    return np.array(rgb, float)


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


def paint(kind, S, T, u01, v01, seed):
    """Albedo (sRGB), roughness, metalness and height (m) of one face's texels. S, T are absolute face metres."""
    n1 = NZ.fbm(S * 0.28 + seed, T * 0.28 - seed)
    n2 = NZ.fbm(S * 1.1 - seed * 0.7, T * 1.1 + 9.1)
    n3 = NZ.fbm(S * 4.3 + 3.3, T * 4.3 + seed * 0.3, 3)
    zero = np.zeros_like(S)
    if kind in ('corr_out', 'corr_in', 'roof', 'ceiling'):
        inner = kind in ('corr_in', 'ceiling')
        if kind in ('roof', 'ceiling'):
            h = corrugation(T, 1.2, 0.05)          # transverse roof ribs
        else:
            h = corrugation(S, L / 21, 0.13)       # 21 side ribs over 24 m (a real 20 ft side x4)
        valley = sstep(0.02, -0.08, h / 0.13)
        base = PAINT * (0.9 + 0.16 * n1)[..., None]
        if not inner:
            base = mix(base, base * 1.07 + 0.02, sstep(6.5, 10.0, T) * 0.5)      # sun-faded upper wall
        grime = sstep(2.4, 0.3, T + 1.2 * (n2 - 0.5)) * (0.75 if not inner else 0.9)   # the dirt band at the foot
        streak = sstep(0.56, 0.78, NZ.fbm(S * 2.6 + seed, T * 0.11 + 4.0, 3)) * sstep(1.0, 9.8, T)
        grime = np.maximum(grime, streak * (0.55 + 0.35 * valley))
        if kind == 'roof':
            stains = sstep(0.5, 0.75, NZ.fbm(S * 0.45 + 2.0, T * 0.45 - 5.0))
            grime = np.maximum(grime * 0 + 0.25 + 0.2 * valley, stains * 0.75)
        if inner:
            grime = np.maximum(grime, 0.35 + 0.15 * n2)
        rust_p = sstep(0.7, 0.77, NZ.fbm(S * 0.55 + 5.0 + seed, T * 0.55 + 9.0) + 0.22 * (n3 - 0.5)
                       + 0.12 * sstep(1.4, 0.4, T) + 0.1 * sstep(9.3, 9.9, T) + (0.02 if kind == 'roof' else 0))
        rust_s = sstep(0.6, 0.86, NZ.fbm(S * 2.2 + 40.0 + seed, T * 0.16, 3)) * (0.3 + 0.7 * sstep(3.0, 9.8, T)) * (0 if kind in ('roof', 'ceiling') else 1)
        chips = sstep(0.8, 0.84, n3 + 0.28 * (n2 - 0.5)) * (1 - rust_p)
        c = mix(base, GRIME * (0.9 + 0.2 * n3)[..., None], grime * 0.72)
        c = mix(c, RUST * 1.1, rust_s * 0.55)
        c = mix(c, mix(RUST, RUST_DARK, n3), rust_p)
        c = mix(c, STEEL * (0.8 + 0.3 * n3)[..., None], chips * 0.8)
        if inner:
            c = c * 0.78
        rough = 0.5 + 0.22 * grime + 0.35 * rust_p - 0.15 * chips + 0.06 * (n3 - 0.5)
        metal = chips * 0.85
        h = h + 0.01 * (n2 - 0.5) - 0.006 * rust_p * n3
        return c, rough, metal, h
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
        return c, 0.82 - 0.1 * scuff + 0.08 * dirt, zero, -0.02 * seam
    if kind in ('frame', 'casting', 'bar', 'lamp'):
        if kind == 'bar':
            base, rough0, metal0 = STEEL * 1.1, 0.38, 0.9
        elif kind == 'lamp':
            base, rough0, metal0 = col(0.78, 0.78, 0.76), 0.45, 0.0
        else:
            base, rough0, metal0 = GUN * (0.85 if kind == 'casting' else 1.0), 0.5, 0.25
        base = base * (0.88 + 0.24 * n1)[..., None]
        rust_p = sstep(0.62, 0.72, NZ.fbm(S * 1.4 + seed, T * 1.4 - seed) + 0.25 * (n3 - 0.5) + (0.08 if kind == 'casting' else 0))
        grime = sstep(1.6, 0.2, T) * 0.6
        c = mix(base, GRIME, grime * 0.6)
        c = mix(c, mix(RUST, RUST_DARK, n3), rust_p * (0 if kind == 'lamp' else 1))
        h = 0.004 * (n2 - 0.5)
        if kind == 'casting':
            hole = ((u01 - 0.5) / 0.3) ** 2 + ((v01 - 0.5) / 0.2) ** 2 < 1.0
            c = np.where(hole[..., None], col(0.03, 0.03, 0.03), c)
            h = np.where(hole, -0.05, h)
        return c, rough0 + 0.3 * rust_p + 0.15 * grime, metal0 * (1 - rust_p), h
    if kind == 'door':
        h = corrugation(S, 0.62, 0.05)
        base = col(0.49, 0.52, 0.55) * (0.88 + 0.22 * n1)[..., None]
        rust_p = sstep(0.64, 0.74, NZ.fbm(S * 0.9 + seed, T * 0.9) + 0.25 * sstep(1.2, 0.3, T))
        grime = np.maximum(sstep(2.0, 0.4, T) * 0.7, sstep(0.6, 0.8, NZ.fbm(S * 2.5, T * 0.14, 3)) * 0.5)
        c = mix(base, GRIME, grime * 0.7)
        c = mix(c, mix(RUST, RUST_DARK, n3), rust_p)
        return c, 0.45 + 0.25 * grime + 0.3 * rust_p, 0.35 * (1 - rust_p), h
    if kind == 'hazard':
        stripe = np.mod((S + T) / 0.9, 1.0) < 0.5
        base = np.where(stripe[..., None], col(0.78, 0.56, 0.14), col(0.07, 0.07, 0.07))
        worn = sstep(0.62, 0.7, n3 + 0.2 * (n2 - 0.5))
        c = mix(base * (0.85 + 0.2 * n1)[..., None], GUN, worn)
        c = mix(c, RUST, sstep(0.7, 0.8, n2) * 0.6)
        return c, 0.55 + 0.2 * worn, 0.2 * worn, 0.003 * (n2 - 0.5)
    if kind == 'window':
        bw = 0.28
        us, vs = u01 * 4.2, v01 * 3.0            # the face's metres (4.2 x 3.0 m frame)
        frame = (us < bw) | (us > 4.2 - bw) | (vs < bw) | (vs > 3.0 - bw) | (np.abs(us - 2.1) < 0.07)
        trim = col(0.86, 0.84, 0.78) * (0.85 + 0.2 * n1)[..., None]
        trim = mix(trim, GRIME, sstep(0.55, 0.8, n2) * 0.5)
        glass = mix(col(0.07, 0.15, 0.18), col(0.2, 0.19, 0.16), sstep(0.8, 0.0, vs) * 0.6 + 0.15 * n2)
        c = np.where(frame[..., None], trim, glass)
        rough = np.where(frame, 0.5, 0.06 + 0.12 * sstep(0.9, 0.0, vs))
        h = np.where(frame, 0.01, 0.0)
        return c, rough, zero, h
    raise ValueError(kind)


def paint_atlas(faces, rects):
    alb = np.zeros((ATLAS, ATLAS, 3)); alb[:] = GUN
    rough = np.full((ATLAS, ATLAS), 0.6)
    metal = np.zeros((ATLAS, ATLAS))
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
        c, r, mt, hgt = paint(f['kind'], S, T, u01, v01, f['seed'])
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
        nrm[ys, xs] = n
    # the shared worn-edge block (chamfers): bare, slightly polished steel, flat normal
    e = slice(ATLAS - EDGE_PX, ATLAS)
    alb[e, e] = col(0.56, 0.56, 0.55)
    rough[e, e] = 0.36
    metal[e, e] = 0.85
    nrm[e, e] = (0, 0, 1)
    return alb, rough, metal, nrm


# ------------------------------------------------------------------------------------------------ geometry
def g2b(p):
    """Game axes (x, y up, z front) -> Blender axes (x, y back, z up); the glTF exporter maps them back."""
    return (p[0], -p[2], p[1])


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


def make_mesh(name, polys, mat=None):
    verts, faces, uvs = [], [], []
    for q, uv in polys:
        i0 = len(verts)
        verts.extend(g2b(v) for v in q)
        faces.append(tuple(range(i0, i0 + len(q))))
        uvs.extend(uv)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    me.validate(clean_customdata=False)
    if uvs:
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', [float(c) for u in uvs for c in u])
    for poly in me.polygons:
        poly.use_smooth = False
    if mat:
        me.materials.append(mat)
    me.update()
    return me


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
            faces.append(dict(id=f"{p['id']}{k}", kind=kind, s0=s0, s1=s1, t0=t0, t1=t1, seed=(len(faces) * 7.31) % 97))
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

    alb, rough, metal, nrm = paint_atlas(faces, rects)

    def new_image(name, rgb, alpha=None, non_color=False):
        img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=False)
        if non_color:
            img.colorspace_settings.name = 'Non-Color'
        px = np.ones((ATLAS, ATLAS, 4), np.float32)
        px[..., :3] = rgb
        # quantize once so the saved PNG equals the painted values (deterministic)
        px = np.round(px * 255) / 255
        img.pixels.foreach_set(px.ravel())
        return img

    # ---- materials: one PBR material for every LOD (Principled + ORM + normal, glTF occlusion group)
    mat = bpy.data.materials.new(f'M_{NAME}')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tex_bc = nt.nodes.new('ShaderNodeTexImage'); tex_bc.name = 'baseColor'
    tex_orm = nt.nodes.new('ShaderNodeTexImage'); tex_orm.name = 'orm'
    tex_n = nt.nodes.new('ShaderNodeTexImage'); tex_n.name = 'normal'
    tex_ao = nt.nodes.new('ShaderNodeTexImage'); tex_ao.name = 'ao_bake'

    # ---- LOD meshes
    root = bpy.data.objects.new(NAME, None)
    sc.collection.objects.link(root)
    lod_objs = []
    for lod in (0, 1, 2):
        polys = []
        for p in P:
            if lod in p['lods']:
                polys += box_polys(p, rects, lod)
        me = make_mesh(f'{NAME}_LOD{lod}', polys, mat)
        ob = bpy.data.objects.new(f'{NAME}_LOD{lod}', me)
        sc.collection.objects.link(ob)
        ob.parent = root
        lod_objs.append(ob)
        print(f'LOD{lod}: {sum(len(q) - 2 for q, _ in polys)} triangles')

    # ---- AO bake (Cycles, LOD0 on a ground plane), into the atlas
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = args.samples
    sc.cycles.seed = 7
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    world = bpy.data.worlds.new('bake')
    sc.world = world
    world.light_settings.distance = 4.0
    gme = bpy.data.meshes.new('ground')
    gme.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('ground', gme)
    sc.collection.objects.link(ground)
    ao_img = bpy.data.images.new('ao_bake', ATLAS, ATLAS, alpha=False, float_buffer=True)
    ao_img.colorspace_settings.name = 'Non-Color'
    tex_ao.image = ao_img
    for n in nt.nodes:
        n.select = False
    tex_ao.select = True
    nt.nodes.active = tex_ao
    bpy.ops.object.select_all(action='DESELECT')
    lod_objs[0].select_set(True)
    bpy.context.view_layer.objects.active = lod_objs[0]
    for ob in lod_objs[1:]:
        ob.hide_render = True                 # LOD1/2 sit on LOD0's faces: they would occlude every ray
    bpy.ops.object.bake(type='AO', margin=PAD, margin_type='EXTEND', use_clear=True)
    for ob in lod_objs[1:]:
        ob.hide_render = False
    ao = np.array(ao_img.pixels[:], np.float32).reshape(ATLAS, ATLAS, 4)[..., 0].astype(float)
    e = slice(ATLAS - EDGE_PX, ATLAS)
    ao[e, e] = 1.0
    ao = np.clip(0.18 + 0.82 * ao, 0, 1)
    bpy.data.objects.remove(ground)
    nt.nodes.remove(tex_ao)
    bpy.data.images.remove(ao_img)
    print(f'AO bake: mean {ao.mean():.3f}, min {ao.min():.3f}')

    # cavity: a light AO multiply into the base colour too (the toon path ignores aoMap)
    alb_ao = alb * (0.72 + 0.28 * ao)[..., None]
    img_bc = new_image(f'{NAME}_baseColor', alb_ao)
    img_orm = new_image(f'{NAME}_orm', np.stack([ao, rough, metal], -1), non_color=True)
    img_n = new_image(f'{NAME}_normal', nrm * 0.5 + 0.5, non_color=True)
    for img in (img_bc, img_orm, img_n):
        img.filepath_raw = os.path.join(args.out, img.name + '.png')
        img.file_format = 'PNG'
        img.save()
    tex_bc.image, tex_orm.image, tex_n.image = img_bc, img_orm, img_n
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex_bc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex_orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nt.links.new(tex_n.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    grp.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gnode = nt.nodes.new('ShaderNodeGroup')
    gnode.node_tree = grp
    nt.links.new(sep.outputs['Red'], gnode.inputs['Occlusion'])

    # ---- COL_ proxies (made after the AO bake: they would occlude it): the sim's boxes (node at the centre, mesh = +-half extents, no material, extras.collider)
    for i, (typ, cc, size) in enumerate(colliders()):
        hx, hy, hz = (v / 2 for v in size)
        vs = [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        idx = lambda sx, sy, sz: ((sx > 0) * 4 + (sy > 0) * 2 + (sz > 0))
        quads = []
        for a in range(3):
            for sg in (-1, 1):
                cs = []
                for d0, d1 in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    k = [0, 0, 0]; k[a] = sg
                    o = [j for j in range(3) if j != a]
                    k[o[0]] = d0; k[o[1]] = d1
                    cs.append(idx(*k))
                n = np.zeros(3); n[a] = sg
                v0, v1, v2 = (np.array(vs[j]) for j in cs[:3])
                if np.dot(np.cross(v1 - v0, v2 - v0), n) < 0:
                    cs = cs[::-1]
                quads.append(cs)
        me = bpy.data.meshes.new(f'COL_{NAME}_{i}')
        me.from_pydata([g2b(v) for v in vs], [], quads)
        me.update()
        ob = bpy.data.objects.new(f'COL_{NAME}_{i}', me)
        ob.location = g2b(cc)
        ob['collider'] = 'box'
        ob['sim_type'] = typ
        sc.collection.objects.link(ob)
        ob.parent = root

    # ---- export
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [root] + list(root.children):
        ob.select_set(True)
    glb = os.path.join(args.out, f'{NAME}.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
        export_image_format='AUTO', export_extras=True, export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False)
    info = dict(glb=os.path.relpath(glb, ROOT), bytes=os.path.getsize(glb), atlas_px_per_m=scale,
                faces=len(faces), colliders=len(colliders()), blender=bpy.app.version_string)
    print('BUILD', json.dumps(info))


main()

# build-bagwall.py (W11 P-GLB1b): builds the master GLB of Kit_Lot_BagWall_01, one 4.8 m module of The Lot's cement-bag
# ("sandbag") wall, with Blender 5 as a Python module (bpy 5.0.1, Python 3.11). The script is the source (no .blend).
#
#   <venv>/bin/python tools/assets/build-bagwall.py [--out assets/masters] [--samples 48]
#
# Why this piece: it is the Lot prop that most often stands next to the containers in the hero views. The two canyon-
# mouth walls stand 5.4 and 5.9 m off the containers' north ends and are the foreground of lot_container_canyon, and
# three more stand in lot_corgi_base (8 walls on the map, all built by props.ts bagWall()).
#
# The module: two rows of sacks in running bond like props.ts bagWall() (row 0: two full sacks; row 1: a half, a full,
# a half), D x rows*BH = 1.6 x 1.1 m in section, 4.8 m long (two nominal 2.4 m sacks; D, BH and 2.4 are read from
# props.ts so the kit follows the world data). The game tiles modules along each wall and stretches them along z by
# len / (m x 4.8) (0.90-1.15 on The Lot), as bagWall() itself stretches its sacks (bl = len / n).
# Axes: +Y up; the wall runs along z (the frame bagWall() builds in); +x is its printed face; the pivot is the base
# centre on the ground. One COL_ box = the sim's 'bags' collider of one module (D x rows*BH x 4.8).
#
# Sacks are superellipsoids (flattened under their weight, bulging at the sides, pinched at the tied ends, with wrinkle
# and fold displacement), each with its own 512 x 256 atlas slot (about 120 px/m, 5x the container's density):
# woven fibre, a printed stencil band, folds and stitching at the ends, mud on the lower row, dust, tide marks.
import argparse
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import Noise, sstep, mix, col, hex_srgb, make_indexed_mesh, build_kit, report  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NAME = 'Kit_Lot_BagWall_01'
ATLAS = 1024
SLOT_W, SLOT_H, PAD = 512, 256, 4

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'masters'))
ap.add_argument('--samples', type=int, default=48)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

# ------------------------------------------------------------------------------------------------ world data
props = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'props.ts'), encoding='utf8').read()
body = props[props.index('export function bagWall('):]
body = body[:body.index('\n}\n')]
m = re.search(r'Math\.round\(len / ([\d.]+)\)', body)
BAG = float(m.group(1))                                   # nominal sack length (2.4)
m = re.search(r'D = ([\d.]+), BH = ([\d.]+)', body)
D, BH = float(m.group(1)), float(m.group(2))              # wall depth (1.6), row height (0.55)
m = re.search(r'rows = (\d+)', body)
ROWS = int(m.group(1))                                    # 2
L0 = 2 * BAG                                              # the module: two nominal sacks (4.8 m)
palette = open(os.path.join(ROOT, 'src', 'client', 'world', 'world-palette.ts'), encoding='utf8').read()
pal = lambda k: hex_srgb(int(re.search(k + r':\s*0x([0-9a-fA-F]{6})', palette).group(1), 16))
RAG, CANVAS, KHAKI, MUD = pal('bannerRag'), pal('canvas'), pal('khaki'), pal('mud')


def colliders():
    """The sim's collider of one module (props.ts bagWall(): colBox('bags', 0, rows*BH/2, 0, D, rows*BH, len))."""
    return [('bags', (0, ROWS * BH / 2, 0), (D, ROWS * BH, L0))]


# sacks: (row, z centre, length, colour, print side (+1 / -1 / 0), seed); running bond like bagWall(); the colours follow
# bagWall()'s (r + k) % 3 == 1 -> canvas, else the pale paper sack
SACKS = [
    (0, -BAG / 2, BAG, RAG, -1, 1.0),
    (0, BAG / 2, BAG, CANVAS, 1, 2.0),
    (1, -BAG * 0.75, BAG / 2, CANVAS, 0, 3.0),
    (1, 0.0, BAG, RAG, 1, 4.0),
    (1, BAG * 0.75, BAG / 2, RAG, 0, 5.0),
]
NZ = Noise(20260931)
E1, E2 = 0.42, 0.5          # superellipse exponents: cross-section (rounded rectangle), length (pinched ends)
B = BH / 1.7                # sack half height before flattening: 0.7 B below the centre + B above = BH
FLAT = 0.7


def smax(a, b, k):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0, 1)
    return a * h + b * (1 - h) + k * h * (1 - h)


def sack_point(th, ph, s, lod):
    """Game-axes position of the sack surface at (theta around the section from the bottom, phi along the length)."""
    row, zc, ln, _, _, seed = s
    st, ct = np.sin(th), np.cos(th)
    cx = np.sign(st) * np.abs(st) ** E1
    cy = -np.sign(ct) * np.abs(ct) ** E1
    r = np.abs(np.cos(ph)) ** E2
    zz = np.sign(np.sin(ph)) * np.abs(np.sin(ph)) ** E2
    a = D / 2 * (1.0 + 0.07 * (1 - cy * cy))                      # the sides bulge under the weight
    x, y, z = a * cx * r, B * cy * r, (ln / 2 + 0.03) * zz
    y = smax(y, -FLAT * B, 0.04)                                  # flattened where it rests
    # folds radiating from the tied ends, a sag in the top, wrinkles (not on the resting underside)
    end = np.abs(np.sin(ph)) ** 6
    fold = 0.022 * np.sin(th * 7 + seed) * end
    wr = 0.012 * (NZ.fbm(th * 2.2 + seed * 7, ph * 3.0 + seed, 3) - 0.5) * 2
    up = sstep(-0.5, -0.2, cy)
    k = (fold + wr) * up
    x, y = x + cx * k, y + cy * k * 0.6
    # per-sack placement: a small yaw and offset (build shifts the whole module so its ground contact is centred)
    yaw = 0.035 * math.sin(seed * 2.1)
    dx = 0.03 * math.cos(seed * 1.7)
    cyaw, syaw = math.cos(yaw), math.sin(yaw)
    X = x * cyaw + z * syaw + dx
    Z = -x * syaw + z * cyaw + zc
    Y = y + FLAT * B + row * BH
    return X, Y, Z


def sack_mesh(s, slot, nth, nph, lod):
    """Vertices (shared), faces and per-corner UVs of one sack at (nth around, nph along) segments."""
    sx, sy = (slot % 2) * SLOT_W, (slot // 2) * SLOT_H
    U = lambda u: (sx + PAD + u * (SLOT_W - 2 * PAD)) / ATLAS
    V = lambda v: (sy + PAD + v * (SLOT_H - 2 * PAD)) / ATLAS
    verts = []
    rings = []
    for j in range(1, nph):
        ph = -math.pi / 2 + math.pi * j / nph
        ring = []
        for i in range(nth):
            th = 2 * math.pi * i / nth
            verts.append(sack_point(np.float64(th), np.float64(ph), s, lod))
            ring.append(len(verts) - 1)
        rings.append((ph, ring))
    south = len(verts); verts.append(sack_point(np.float64(0), np.float64(-math.pi / 2), s, lod))
    north = len(verts); verts.append(sack_point(np.float64(0), np.float64(math.pi / 2), s, lod))
    faces, uvs = [], []
    vv = lambda ph: (ph + math.pi / 2) / math.pi
    for j in range(len(rings) - 1):
        (p0, r0), (p1, r1) = rings[j], rings[j + 1]
        for i in range(nth):
            i1 = (i + 1) % nth
            u0, u1 = i / nth, (i + 1) / nth
            faces.append((r0[i], r0[i1], r1[i1], r1[i]))
            uvs += [(U(u0), V(vv(p0))), (U(u1), V(vv(p0))), (U(u1), V(vv(p1))), (U(u0), V(vv(p1)))]
    for i in range(nth):
        i1 = (i + 1) % nth
        u0, u1, um = i / nth, (i + 1) / nth, (i + 0.5) / nth
        p0 = rings[0][0]
        faces.append((south, rings[0][1][i1], rings[0][1][i]))
        uvs += [(U(um), V(0.0)), (U(u1), V(vv(p0))), (U(u0), V(vv(p0)))]
        p1 = rings[-1][0]
        faces.append((north, rings[-1][1][i], rings[-1][1][i1]))
        uvs += [(U(um), V(1.0)), (U(u0), V(vv(p1))), (U(u1), V(vv(p1)))]
    return verts, faces, uvs


def fix_winding(verts, faces, uvs, centre):
    """Counter-clockwise seen from outside (outward = away from the sack's centre)."""
    out_f, out_uv, k = [], [], 0
    for f in faces:
        n = len(f)
        q = [np.array(verts[i]) for i in f]
        nn = np.cross(q[1] - q[0], q[2] - q[0])
        c = sum(q) / n
        if np.dot(nn, c - centre) < 0:
            out_f.append(tuple(reversed(f)))
            out_uv += list(reversed(uvs[k:k + n]))
        else:
            out_f.append(f)
            out_uv += uvs[k:k + n]
        k += n
    return out_f, out_uv


def build_lod(lod, mat, shift):
    """LOD0: 5 sacks at 16 x 12; LOD1: 5 sacks at 8 x 6; LOD2: one 8 x 4 hull per row (textured with a sack slot)."""
    V, F, UV = [], [], []
    if lod < 2:
        nth, nph = (16, 12) if lod == 0 else (8, 6)
        parts = [(s, k) for k, s in enumerate(SACKS)]
    else:
        nth, nph = 8, 4
        parts = [((0, 0.0, L0, RAG, 0, 1.0), 0), ((1, 0.0, L0, RAG, 0, 4.0), 3)]
    for s, slot in parts:
        v, f, uv = sack_mesh(s, slot, nth, nph, lod)
        centre = np.array([0.0, FLAT * B + s[0] * BH, s[1]])
        f, uv = fix_winding(v, f, uv, centre)
        o = len(V)
        V += [(p[0] - shift[0], p[1] - shift[1], p[2] - shift[2]) for p in v]
        F += [tuple(i + o for i in ff) for ff in f]
        UV += uv
    return make_indexed_mesh(f'{NAME}_LOD{lod}', V, F, UV, mat, smooth=True)


# ------------------------------------------------------------------------------------------------ painting
def paint_sack(s, slot):
    """Albedo, roughness, height (m) of one sack's slot: (theta, phi) per texel -> metres around / along."""
    row, zc, ln, base_col, print_side, seed = s
    w, h = SLOT_W - 2 * PAD, SLOT_H - 2 * PAD
    ii = (np.arange(-PAD, w + PAD) + 0.5) / w
    jj = (np.arange(-PAD, h + PAD) + 0.5) / h
    u, v = np.meshgrid(ii, jj)
    th, ph = u * 2 * np.pi, (v - 0.5) * np.pi
    Um = u * 4.1                                              # metres around the section (about 4.1 m)
    Vm = v * ln                                               # metres along the sack
    cy = -np.cos(th)                                          # -1 bottom .. 1 top
    side = np.sin(th)                                         # +1 = +x face, -1 = -x face
    endk = sstep(0.55, 0.95, np.abs(np.sin(ph)))              # the tied / folded ends
    n1 = NZ.fbm(Um * 1.3 + seed * 5, Vm * 1.3 - seed)
    n2 = NZ.fbm(Um * 4.5 - seed, Vm * 4.5 + seed * 3, 3)
    n3 = NZ.fbm(Um * 13 + seed, Vm * 13 - seed, 2)
    # woven fibre: a 4 cm weave and a fibre grain along the sack
    weave = np.sin(2 * np.pi * Um / 0.04) * np.sin(2 * np.pi * Vm / 0.04)
    grain = NZ.fbm(Um * 30 + seed, Vm * 2.0, 2)
    c = base_col * (0.86 + 0.14 * n1 + 0.05 * (grain - 0.5) + 0.025 * weave)[..., None]
    c = mix(c, c * col(0.92, 0.9, 0.86), 0.5 * (1 - n2))      # uneven, handled cloth
    # folds and stitching at the ends
    folds = np.sin(th * 7 + seed) * endk
    c = mix(c, c * 0.72, np.clip(-folds, 0, 1) * 0.6)
    stitch = sstep(0.035, 0.0, np.minimum(Vm, ln - Vm) - 0.08) * sstep(0.35, 0.5, np.mod(Um / 0.05, 1.0))
    c = mix(c, c * 0.55, stitch * 0.8)
    # printed stencil band on the side (block "text" and a rule), worn by the cloth
    prt = np.zeros_like(u)
    if print_side:
        side_ok = sstep(0.55, 0.8, side * print_side)
        band = sstep(0.34, 0.31, np.abs(cy)) * sstep(ln * 0.3, ln * 0.28, np.abs(Vm - ln / 2))
        glyph = NZ.v(np.floor(Vm / 0.075) * 3.7 + seed, np.floor((cy + 1) / 0.1) * 1.9) > 0.35
        text = (np.mod(Vm / 0.075, 1.0) < 0.72) & (np.mod((cy + 1) / 0.1, 1.0) < 0.66) & (np.abs(cy) < 0.2) & glyph
        rule = (np.abs(np.abs(cy) - 0.27) < 0.02)
        prt = side_ok * band * np.where(text | rule, 1.0, 0.0) * sstep(0.25, 0.45, n3 + 0.3 * n2)
        c = mix(c, KHAKI * 0.42, prt * 0.85)
    # mud (lower row: the lower half and splashes), dust on top, tide marks
    low = 1.0 if row == 0 else 0.35
    mud = sstep(0.1, -0.55, cy + 0.35 * (n2 - 0.5)) * low
    splash = sstep(0.8, 0.86, NZ.fbm(Um * 9 + 40, Vm * 9 - seed, 2)) * sstep(0.6, -0.3, cy) * low
    mud = np.maximum(mud, splash * 0.8)
    c = mix(c, MUD * (0.85 + 0.3 * n3)[..., None], mud * 0.8)
    tide = sstep(0.018, 0.0, np.abs(cy + 0.25 + 0.15 * (n1 - 0.5))) * low * 0.5
    c = mix(c, c * 0.7, tide)
    dust = sstep(0.4, 0.9, cy) * 0.25 * sstep(0.3, 0.7, n1)
    c = mix(c, col(0.62, 0.58, 0.5), dust)
    rough = 0.86 + 0.06 * (grain - 0.5) + 0.06 * mud - 0.06 * prt + 0.04 * endk
    hgt = 0.0007 * weave + 0.0015 * (grain - 0.5) + 0.006 * folds - 0.003 * stitch + 0.002 * (n2 - 0.5)
    return c, rough, hgt, (w / 4.1, h / ln)


def paint_atlas():
    alb = np.zeros((ATLAS, ATLAS, 3)); alb[:] = CANVAS * 0.5
    rough = np.full((ATLAS, ATLAS), 0.9)
    nrm = np.zeros((ATLAS, ATLAS, 3)); nrm[..., 2] = 1
    for k, s in enumerate(SACKS):
        c, r, hgt, (ku, kv) = paint_sack(s, k)
        dhu = np.gradient(hgt, axis=1) * ku
        dhv = np.gradient(hgt, axis=0) * kv
        n = np.stack([-dhu, -dhv, np.ones_like(hgt)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        x0, y0 = (k % 2) * SLOT_W, (k // 2) * SLOT_H
        ys, xs = slice(y0, y0 + SLOT_H), slice(x0, x0 + SLOT_W)
        alb[ys, xs] = np.clip(c, 0, 1)
        rough[ys, xs] = np.clip(r, 0.04, 1)
        nrm[ys, xs] = n
    return alb, rough, np.zeros((ATLAS, ATLAS)), nrm


# ------------------------------------------------------------------------------------------------ build
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    # ground contact: shift so LOD0 sits on y = 0 with its contact centred on x = z = 0
    pts = []
    for k, s in enumerate(SACKS):
        v, _, _ = sack_mesh(s, k, 16, 12, 0)
        pts += v
    P = np.array(pts)
    y0 = P[:, 1].min()
    foot = P[P[:, 1] < y0 + 0.01]
    shift = ((foot[:, 0].min() + foot[:, 0].max()) / 2, y0, (foot[:, 2].min() + foot[:, 2].max()) / 2)
    print(f'contact shift: {shift[0]:.4f} {shift[1]:.4f} {shift[2]:.4f} m')
    alb, rough, metal, nrm = paint_atlas()
    info = build_kit(NAME, lambda mat: [build_lod(i, mat, shift) for i in range(3)], colliders(), alb, rough, metal, nrm,
                     args.out, ATLAS, samples=args.samples, ao_distance=1.2, ao_floor=0.25, ao_into_albedo=0.3, pad=PAD)
    info.update(module_m=L0, section_m=[D, ROWS * BH], sacks=len(SACKS), px_per_m=round((SLOT_W - 2 * PAD) / 4.1, 1))
    report(info, ROOT)


main()

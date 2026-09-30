# build-footing.py (W11 P-GLB3): builds the master GLB of Kit_Lot_Footing_01, The Lot's cast concrete footing block
# (props.ts footing(): the corgi base's six "Foundation" blocks), with Blender 5 as a Python module (bpy 5.0.1,
# Python 3.11). The script is the source (no .blend).
#
#   <venv>/bin/python tools/assets/build-footing.py [--out assets/masters] [--samples 48]
#
# Why this piece: counted from the data (createWorldData(1, 'the_lot'), colliders inside each hero bookmark's view, 96
# degrees wide and 150 m deep, containers / bag walls / pipes / floodlights excluded): lot_corgi_base holds 6 footings,
# 4 ammo crates, 1 pallet stack, 1 cable drum; lot_container_canyon holds 4 pallet stacks (one hidden inside c_west),
# 4 barrels, 4 cones, 3 drums, 2 skips, 1 rebar bundle. Over the two views the footing is the most repeated prop (6, all
# of them in the base's foreground at 29-41 m), ahead of the pallet stack (5, one of them hidden) and crates, barrels,
# cones and drums (4 each).
#
# The block: W x H x W (3.2 x 1.4 x 3.2 m, read from props.ts) with 6 cm arrises, board-formed sides, a trowelled top
# with an oil stain and two lifting anchors, and the two plywood formwork panels footing() puts on +-x (left in place)
# with timber walers and tie-rod nuts. Axes: +Y up, pivot at the base centre on the ground; COL_ = the sim's 'footing'
# box (one). The game turns each instance by its collider's yaw (a jitter of up to 0.05 rad).
import argparse
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import (Noise, sstep, mix, col, palette, solve_atlas, paint_faces, poly_mesh, box_faces, box_polys,  # noqa: E402
                    build_kit, report)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NAME = 'Kit_Lot_Footing_01'
ATLAS = 1024
PAD = 4

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'masters'))
ap.add_argument('--samples', type=int, default=48)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

props = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'props.ts'), encoding='utf8').read()
body = props[props.index('export function footing('):]
body = body[:body.index('\n}\n')]
m = re.search(r'const w = ([\d.]+), h = ([\d.]+)', body)
W, H = float(m.group(1)), float(m.group(2))
CONCRETE, PLY, PLY_D, OIL = palette(ROOT, 'concrete'), palette(ROOT, 'plywood'), palette(ROOT, 'plywoodDark'), palette(ROOT, 'oilStain')
RUST, MUD, TIMBER = palette(ROOT, 'rust'), palette(ROOT, 'mud'), palette(ROOT, 'fenceWood')
CH = 0.06                                     # the block's arris chamfer (the prim's bev)
PT = 0.04                                     # formwork panel thickness (footing(): 0.04, h - 0.2 x w - 0.2)


def colliders():
    """props.ts footing(): f.solid('footing', 0, h / 2, 0, w, h, w)."""
    return [('footing', (0, H / 2, 0), (W, H, W))]


# parts: (id, centre, size, face kinds (None = hidden), chamfer, LODs)
def parts():
    P = []
    ALL = ('+x', '-x', '+y', '-y', '+z', '-z')
    fk = lambda d: {k: d.get(k) for k in ALL}
    P.append(('body', (0, H / 2, 0), (W, H, W), fk({'+x': 'side', '-x': 'side', '+z': 'side', '-z': 'side', '+y': 'top'}), CH, (0, 1, 2)))
    for s in (-1, 1):
        o = '+x' if s > 0 else '-x'
        px = s * (W / 2 + PT / 2)
        P.append((f'panel{s:+d}', (px, H / 2, 0), (PT, H - 0.2, W - 0.2), fk({o: 'ply', '+y': 'plyedge', '-y': 'plyedge', '+z': 'plyedge', '-z': 'plyedge'}), 0.0, (0, 1)))
        for wy in (0.38, H - 0.38):                                     # two timber walers across each panel
            wx = s * (W / 2 + PT + 0.05)
            P.append((f'waler{s:+d}{wy:.2f}', (wx, wy, 0), (0.1, 0.14, W - 0.1), fk({o: 'timber', '+y': 'timber', '-y': 'timber', '+z': 'timberend', '-z': 'timberend'}), 0.0, (0, 1)))
            for tz in (-0.9, 0.9):                                      # tie-rod nuts and washers through the walers
                P.append((f'nut{s:+d}{wy:.2f}{tz:+.1f}', (s * (W / 2 + PT + 0.1 + 0.02), wy, tz), (0.04, 0.12, 0.12), fk({o: 'steel', '+y': 'steel', '-y': 'steel', '+z': 'steel', '-z': 'steel'}), 0.0, (0,)))
    return P


DENSITY = {'side': 1.0, 'top': 1.0, 'ply': 0.9, 'plyedge': 0.6, 'timber': 0.7, 'timberend': 0.7, 'steel': 0.6}


# ------------------------------------------------------------------------------------------------ painting
NZ = Noise(20261002)


def board_concrete(S, T, seed, up):
    """Board-formed concrete: plank impressions (0.35 m boards, their joints and grain), cement mottling, bug holes."""
    n1 = NZ.fbm(S * 0.9 + seed * 3, T * 0.9 - seed, 4)
    n2 = NZ.fbm(S * 3.5 - seed, T * 3.5 + seed, 3)
    grit = NZ.v(S * 160 + seed * 11, T * 160 - seed * 3)
    c = CONCRETE * (0.82 + 0.22 * n1)[..., None]
    board = np.floor(T / 0.35)
    bshade = NZ.v(board * 5.3 + seed, 0.5)
    c = c * (0.95 + 0.1 * bshade)[..., None]
    grain = NZ.fbm(S * 1.2 + board * 7, T * 40, 2)
    joint = sstep(0.012, 0.0, np.abs(np.mod(T, 0.35) - 0.175) - 0.163) if up else np.zeros_like(S)
    c = mix(c, c * 0.8, joint * 0.8)
    c = c * (0.97 + 0.06 * grain)[..., None]
    c = mix(c, c * 0.7, sstep(0.8, 0.9, grit) * 0.6)
    bug = sstep(0.84, 0.9, NZ.v(S * 45 + seed, T * 45 + 3)) * sstep(0.5, 0.7, n2)
    c = mix(c, c * 0.4, bug)
    hgt = 0.0008 * (grit - 0.5) + 0.0012 * (grain - 0.5) - 0.0015 * joint - 0.002 * bug + 0.001 * (n2 - 0.5)
    return c, 0.9 + 0.05 * (n2 - 0.5), hgt


def paint(f, S, T):
    kind, key, seed = f['kind'], f['key'], sum(map(ord, f['id'])) % 97
    zero = np.zeros_like(S)
    if kind == 'side':
        c, rough, hgt = board_concrete(S, T, seed, True)
        y = T                                                       # metres above the base
        n1 = NZ.fbm(S * 1.4 + seed, T * 1.4, 3)
        # mud splash and damp at the foot, efflorescence where the damp dries, rust bleed from the tie holes
        damp = sstep(0.45, 0.0, y + 0.15 * (n1 - 0.5))
        c = mix(c, c * 0.68, damp)
        splash = sstep(0.6, 0.7, NZ.fbm(S * 8 + seed, T * 8, 3)) * sstep(0.6, 0.05, y)
        c = mix(c, MUD, np.maximum(splash, sstep(0.12, 0.0, y)) * 0.8)
        eff = sstep(0.03, 0.0, np.abs(y - 0.48 - 0.1 * (n1 - 0.5))) * sstep(0.4, 0.6, n1)
        c = mix(c, col(0.83, 0.82, 0.78), eff * 0.5)
        runs = sstep(0.62, 0.75, NZ.fbm(S * 9 + seed, 0.3, 2)) * sstep(0.2, 1.3, y) * (0.3 + 0.7 * n1)
        c = mix(c, c * 0.78, runs * 0.5)                            # rain run-off from the top arris
        # arris wear: the top edge chips pale
        edge = sstep(0.1, 0.0, H - y) * sstep(0.55, 0.65, NZ.fbm(S * 6, T * 6 + seed, 2))
        c = mix(c, col(0.7, 0.68, 0.63), edge * 0.6)
        return c, rough - 0.3 * damp - 0.1 * splash, zero, hgt - 0.005 * edge, zero
    if kind == 'top':
        # trowelled top: swirl marks, the oil stain footing() puts at (0.6, -0.4) 1.2 x 0.9, two lifting anchors, grit
        X, Z = S - W / 2, (W - T) - W / 2                          # +y face: s = +x, t = -z
        n1 = NZ.fbm(S * 1.1 + 9, T * 1.1, 4)
        sw = NZ.fbm(S * 5 + np.sin(T * 3) * 0.5, T * 5, 3)
        c = CONCRETE * (0.86 + 0.18 * n1 + 0.05 * (sw - 0.5))[..., None]
        grit = NZ.v(S * 150 + 3, T * 150)
        c = mix(c, c * 0.72, sstep(0.82, 0.92, grit) * 0.5)
        oil = sstep(1.0, 0.7, np.hypot((X - 0.6) / 0.6, (Z + 0.4) / 0.45) + 0.35 * (NZ.fbm(S * 3, T * 3 + 5, 3) - 0.5))
        c = mix(c, OIL * 0.8, oil * 0.85)
        ring = sstep(0.06, 0.0, np.abs(np.hypot((X - 0.6) / 0.6, (Z + 0.4) / 0.45) - 0.95)) * 0.4
        c = mix(c, OIL, ring)
        anchors = np.zeros_like(S)
        for ax, az in ((-0.9, 0.9), (0.9, -0.9 - 0.5)):
            d = np.hypot(X - ax, Z - az)
            anchors = np.maximum(anchors, sstep(0.1, 0.08, d))
            c = mix(c, RUST * 0.9, sstep(0.28, 0.1, d) * 0.5 * sstep(0.3, 0.6, NZ.fbm(S * 9, T * 9, 2)))
        c = mix(c, col(0.08, 0.08, 0.08), anchors)
        dust = sstep(0.55, 0.75, NZ.fbm(S * 2 + 30, T * 2, 3))
        c = mix(c, col(0.58, 0.52, 0.44), dust * 0.35)
        puddle = sstep(0.62, 0.7, NZ.fbm(S * 0.8 + 70, T * 0.8, 3))
        c = mix(c, c * 0.75, puddle * 0.5)
        edge = sstep(0.08, 0.0, np.minimum(np.minimum(S, W - S), np.minimum(T, W - T))) * sstep(0.5, 0.62, NZ.fbm(S * 7, T * 7, 2))
        c = mix(c, col(0.7, 0.68, 0.63), edge * 0.6)
        rough = 0.82 + 0.06 * (sw - 0.5) - 0.5 * oil - 0.25 * puddle
        hgt = 0.0006 * (grit - 0.5) + 0.001 * (sw - 0.5) - 0.02 * anchors - 0.004 * edge
        return c, rough, zero, hgt, zero
    if kind in ('ply', 'plyedge'):
        # form plywood, weathered: veneer grain along the panel, grey sun-bleach at the top, form-oil blotches, nail rows
        n1 = NZ.fbm(S * 0.8 + seed, T * 0.8, 3)
        grain = NZ.fbm(S * 1.5 + np.sin(T * 7 + S) * 0.3, T * 26 + seed, 3)
        c = PLY * (0.78 + 0.18 * n1 + 0.12 * (grain - 0.5))[..., None]
        c = mix(c, PLY_D, sstep(0.55, 0.8, grain) * 0.6)
        c = mix(c, col(0.55, 0.52, 0.47), sstep(0.5, 1.2, T) * 0.45)            # sun-grey toward the top
        blot = sstep(0.6, 0.75, NZ.fbm(S * 2 + 40, T * 2, 3))
        c = mix(c, c * 0.6, blot * 0.6)
        if kind == 'ply':
            nails = (sstep(0.03, 0.0, np.abs(np.mod(S, 0.4) - 0.2) - 0.012) * sstep(0.03, 0.0, np.minimum(np.abs(T - 0.08), np.abs(T - (f['h'] - 0.08))) - 0.012))
            c = mix(c, col(0.15, 0.13, 0.12), nails)
            stencil = (sstep(0.02, 0.0, np.abs(T - f['h'] * 0.5) - 0.07) * sstep(0.02, 0.0, np.abs(S - f['w'] * 0.25) - 0.3)
                       * (np.mod(S / 0.08, 1.0) < 0.7) * (NZ.v(np.floor(S / 0.08) * 3.1, 2.0) > 0.35))
            c = mix(c, col(0.1, 0.1, 0.12), stencil * 0.75 * sstep(0.3, 0.5, n1 + 0.2))
        foot = sstep(0.3, 0.0, T)
        c = mix(c, MUD * 1.1, foot * 0.7)
        hgt = 0.0008 * (grain - 0.5)
        return c, 0.78 + 0.1 * (grain - 0.5) + 0.1 * blot, zero, hgt, zero
    if kind in ('timber', 'timberend'):
        grain = NZ.fbm(S * 0.6 + seed, T * 30, 3) if kind == 'timber' else NZ.fbm(np.hypot(S - 0.05, T - 0.07) * 40, seed, 2)
        c = TIMBER * (0.7 + 0.35 * grain)[..., None]
        c = mix(c, col(0.4, 0.38, 0.35), 0.35)
        knot = sstep(0.86, 0.9, NZ.v(S * 3 + seed, T * 3))
        c = mix(c, c * 0.5, knot)
        return c, 0.85 + zero, zero, 0.001 * (grain - 0.5), zero
    # steel: rusty nuts and washers
    n1 = NZ.fbm(S * 30 + seed, T * 30, 2)
    c = mix(col(0.22, 0.2, 0.19), RUST, sstep(0.3, 0.7, n1))
    return c, 0.7 + zero, 0.35 * (1 - n1), 0.0005 * n1, zero


# ------------------------------------------------------------------------------------------------ build
def build_lod(lod, mat, rects, F, P):
    polys = []
    for pid, c, size, kinds, ch, lods in P:
        if lod not in lods:
            continue
        polys += box_polys(pid, c, size, kinds, rects, ATLAS, F, ch=ch if lod == 0 else 0.0)
    if lod == 2:
        # the panels as flat quads on the block's +-x faces (the block and two quads)
        for s in (-1, 1):
            k = '+x' if s > 0 else '-x'
            pid = f'panel{s:+d}'
            polys += box_polys(pid, (s * (W / 2 + PT / 2), H / 2, 0), (PT, H - 0.2, W - 0.2), {k: 'ply'}, rects, ATLAS, F)
    return poly_mesh(f'{NAME}_LOD{lod}', polys, mat)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    P = parts()
    faces = []
    for k, (pid, c, size, kinds, ch, lods) in enumerate(P):
        faces += box_faces(pid, size, kinds, seed=k)
    px_m, rects = solve_atlas(faces, ATLAS, PAD, DENSITY)
    F = {f['id']: f for f in faces}
    print(f'atlas: {len(faces)} faces, {px_m} px/m')
    alb, rough, metal, nrm, _ = paint_faces(faces, rects, paint, ATLAS, PAD, CONCRETE * 0.7, 0.9)
    info = build_kit(NAME, lambda mat: [build_lod(i, mat, rects, F, P) for i in range(3)], colliders(), alb, rough, metal,
                     nrm, args.out, ATLAS, samples=args.samples, ao_distance=1.5, ao_floor=0.25, ao_into_albedo=0.25, pad=PAD)
    info.update(px_per_m=px_m, block_m=[W, H, W])
    report(info, ROOT)


main()

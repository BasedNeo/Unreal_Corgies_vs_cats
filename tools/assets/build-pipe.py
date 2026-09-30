# build-pipe.py (W11 P-GLB3): builds the master GLB of Kit_Lot_Pipe_01, one segment of The Lot's concrete drainage pipe
# (the Pipeworks' tunnels, chapter 7's sneak route, and the two loose pipes in the Mud), with Blender 5 as a Python
# module (bpy 5.0.1, Python 3.11). The script is the source (no .blend).
#
#   <venv>/bin/python tools/assets/build-pipe.py [--out assets/masters] [--samples 48]
#
# The segment is lot/pipes.ts addPipe() with layout.ts PIPE (read from the source): an N-sided tube (N = 12, vertex radii
# ro 3.0 / ri 2.55, 9 m long) spun by pi/N so the floor, crown and both sides are flat facets. The outer and inner
# facets lie exactly on the sim's facet boxes, so the bore IS the tunnel the sim walks and lotInteriors()'s box (the
# inner apothem ri cos(pi/N) across, mouth to mouth) holds it. As on the client's lathe, only the outer rims carry a
# 0.12 m chamfer (LOD0); the bore stays the exact N-gon.
# Axes: +Y up; the pipe axis runs along z (the tunnels' own heading; the loose pipes turn it pi/2); the pivot is the
# base centre on the ground (the outer floor facet). COL_: the sim's N facet boxes (props: 'pipe'): the four facets on
# the axes are plain boxes, the eight between them oriented boxes (extras.collider = 'obb', a node rotation about z).
# Shading: the barrel is smooth (welded around), the rims and mouths hard, so the 12-gon reads round.
import argparse
import math
import os
import re
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import (Noise, sstep, mix, col, palette, solve_atlas, face_uv, paint_faces, poly_mesh, rot_z,  # noqa: E402
                    build_kit, report)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
NAME = 'Kit_Lot_Pipe_01'
ATLAS = 1024
PAD = 4

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'masters'))
ap.add_argument('--samples', type=int, default=48)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

# ------------------------------------------------------------------------------------------------ world data
layout = open(os.path.join(ROOT, 'src', 'shared', 'world', 'lot', 'layout.ts'), encoding='utf8').read()
m = re.search(r'export const PIPE = \{([^}]*)\}', layout)
P = {k: float(v) for k, v in re.findall(r'(\w+):\s*([-\d.]+)', m.group(1))}
RO, RI, N, L = P['ro'], P['ri'], int(P['seg']), P['len']
COSH, SINH = math.cos(math.pi / N), math.sin(math.pi / N)
AO_, AI_ = RO * COSH, RI * COSH           # outer / inner apothem (the facets' distance from the axis)
YC = AO_                                  # the axis height: the outer floor facet on y = 0
CH = 0.12                                 # the lathe's rim chamfer (LOD0, outer rims only)
WF_O, WF_I = 2 * RO * SINH, 2 * RI * SINH  # facet widths
TH0 = math.pi * 1.5 - math.pi / N          # the UV wrap seam: the vertex at the floor facet's -x edge (hidden low)
CONCRETE, MUD, RUST, OCHRE = palette(ROOT, 'concrete'), palette(ROOT, 'mud'), palette(ROOT, 'rust'), palette(ROOT, 'hazardOchre')


def vtx(j):
    """Vertex angle j (the lathe's: facets between consecutive vertices have normals on multiples of 2 pi / N)."""
    return TH0 + 2 * math.pi * j / N


def ring(r, j, z):
    a = vtx(j)
    return np.array([r * math.cos(a), YC + r * math.sin(a), z])


def colliders():
    """The sim's facet boxes (pipes.ts addPipe()) in the kit frame (axis along z): normal angle th, centre on the axis
    + n rMid, size (tangential width, radial thickness, length)."""
    r_mid, thick, width = (RO + RI) / 2 * COSH, (RO - RI) * COSH, 2 * RO * SINH
    out = []
    for k in range(N):
        th = 2 * math.pi * k / N                       # 0 = +x side, pi/2 = crown, pi = -x side, 3pi/2 = floor
        c = (r_mid * math.cos(th), YC + r_mid * math.sin(th), 0.0)
        a = th - math.pi / 2                           # Rz(a) turns the box's local +y onto the facet normal
        q = round(a / (math.pi / 2))
        if abs(a - q * math.pi / 2) < 1e-9:            # on an axis: a plain axis-aligned box
            size = (width, thick, L) if q % 2 == 0 else (thick, width, L)
            out.append(('pipe', c, size))
        else:
            out.append(('pipe', c, (width, thick, L), rot_z(a)))
    return out


# ------------------------------------------------------------------------------------------------ atlas faces
# outer barrel and bore: 4 faces of 3 facets each (continuous arc metres from the wrap seam); the two mouths: one
# strip of 12 trapezoids each; LOD2's mouth caps: one small dark face
GROUPS = 4
PER = N // GROUPS
DENSITY = {'out': 1.0, 'in': 0.62, 'end': 1.0, 'cap': 0.25}


def faces():
    F = []
    for g in range(GROUPS):
        F.append(dict(id=f'out{g}', kind='out', w=PER * WF_O, h=L, s0=g * PER * WF_O, g=g, seed=g))
        F.append(dict(id=f'in{g}', kind='in', w=PER * WF_I, h=L, s0=g * PER * WF_I, g=g, seed=g + 10))
    for e in (-1, 1):
        F.append(dict(id=f'end{e:+d}', kind='end', w=N * WF_O, h=RO - RI, s0=0.0, e=e, seed=20 + e))
    F.append(dict(id='cap', kind='cap', w=2 * RO, h=2 * RO, s0=0.0, seed=30))
    return F


# ------------------------------------------------------------------------------------------------ geometry
def quad(q, st, face, rects, N_out, grp):
    """A polygon with face-local (s, t) per vertex: wound so its normal points along N_out, and with UVs that are
    not mirrored against it (s is flipped inside the face if the (s, t) frame would be left-handed)."""
    q = [np.asarray(v, float) for v in q]
    if np.dot(np.cross(q[1] - q[0], q[2] - q[0]), N_out) < 0:
        q, st = q[::-1], st[::-1]
    d1, d2 = q[1] - q[0], q[2] - q[0]
    (s1, t1), (s2, t2) = (st[1][0] - st[0][0], st[1][1] - st[0][1]), (st[2][0] - st[0][0], st[2][1] - st[0][1])
    det = s1 * t2 - s2 * t1
    T = (d1 * t2 - d2 * t1) / det
    B = (d2 * s1 - d1 * s2) / det
    if np.dot(np.cross(T, B), N_out) < 0:
        st = [(face['w'] - s, t) for s, t in st]
    uv = [face_uv(rects[face['id']], face, s, t, ATLAS) for s, t in st]
    return (q, uv, grp)


def barrel(rects, F, r, wf, kind, z0, z1, t0, t1, grp, outward):
    polys = []
    for j in range(N):
        g, k = divmod(j, PER)
        f = F[f'{kind}{g}']
        s_a, s_b = k * wf, (k + 1) * wf
        q = [ring(r, j, z0), ring(r, j + 1, z0), ring(r, j + 1, z1), ring(r, j, z1)]
        st = [(s_a, t0), (s_b, t0), (s_b, t1), (s_a, t1)]
        mid = (vtx(j) + vtx(j + 1)) / 2
        n = np.array([math.cos(mid), math.sin(mid), 0.0]) * (1 if outward else -1)
        polys.append(quad(q, st, f, rects, n, grp))
    return polys


def build_lod(lod, mat, rects, F):
    polys = []
    ch = CH if lod == 0 else 0.0
    zb = L / 2 - ch
    if lod < 2:
        polys += barrel(rects, F, RO, WF_O, 'out', -zb, zb, ch, L - ch, 'o', True)
        polys += barrel(rects, F, RI, WF_I, 'in', -L / 2, L / 2, 0.0, L, 'i', False)
        r_rim = (AO_ - ch) / COSH                      # the rim's vertex radius (the chamfer is 0.12 m in apothem)
        for e in (-1, 1):
            zf = e * L / 2
            fe = F[f'end{e:+d}']
            for j in range(N):
                q = [ring(RI, j, zf), ring(RI, j + 1, zf), ring(r_rim, j + 1, zf), ring(r_rim, j, zf)]
                st = [(j * WF_O, 0.0), ((j + 1) * WF_O, 0.0), ((j + 1) * WF_O, r_rim - RI), (j * WF_O, r_rim - RI)]
                polys.append(quad(q, st, fe, rects, np.array([0, 0, e], float), None))
            if ch:
                # the rim chamfer: samples the outer faces' end strips (t 0..ch / L-ch..L)
                for j in range(N):
                    g, k = divmod(j, PER)
                    f = F[f'out{g}']
                    q = [ring(RO, j, e * zb), ring(RO, j + 1, e * zb), ring(r_rim, j + 1, zf), ring(r_rim, j, zf)]
                    ta, tb = (L - ch, L) if e > 0 else (ch, 0.0)
                    st = [(k * WF_O, ta), ((k + 1) * WF_O, ta), ((k + 1) * WF_O, tb), (k * WF_O, tb)]
                    mid = (vtx(j) + vtx(j + 1)) / 2
                    n = np.array([math.cos(mid), math.sin(mid), e], float)
                    polys.append(quad(q, st, f, rects, n, f'c{e}'))
    else:
        # LOD2: the outer barrel and a dark cap over each mouth (the bore reads as a black disc at 160 m+)
        polys += barrel(rects, F, RO, WF_O, 'out', -L / 2, L / 2, 0.0, L, 'o', True)
        fc = F['cap']
        for e in (-1, 1):
            q = [ring(RO, j, e * L / 2) for j in range(N)]
            st = [(float(v[0] + RO), float(v[1] - YC + RO)) for v in q]
            for j in range(1, N - 1):                  # a fan of triangles (the exporter's tangents need tris / quads)
                polys.append(quad([q[0], q[j], q[j + 1]], [st[0], st[j], st[j + 1]], fc, rects, np.array([0, 0, e], float), None))
    return poly_mesh(f'{NAME}_LOD{lod}', [(q, uv, g) for q, uv, g in polys], mat)


# ------------------------------------------------------------------------------------------------ painting
NZ = Noise(20261001)
LIME = col(0.80, 0.79, 0.74)
ALGAE = col(0.16, 0.19, 0.12)
SOOT = col(0.10, 0.10, 0.10)


def theta_of(face, S):
    """Angle around the axis of a barrel texel (outer: s runs with the angle; bore: against it)."""
    if face['kind'] == 'out':
        return TH0 + (face['s0'] + S) / WF_O * (2 * math.pi / N)
    return TH0 + (face['s0'] + (face['w'] - S)) / WF_I * (2 * math.pi / N)


def concrete(Sg, T, seed, base):
    """Cast concrete: mottled cement, aggregate specks, bug holes. Returns rgb, rough, height."""
    n1 = NZ.fbm(Sg * 0.45 + seed * 3.1, T * 0.45 - seed, 4)
    n2 = NZ.fbm(Sg * 2.3 - seed, T * 2.3 + seed * 1.7, 3)
    grit = NZ.v(Sg * 90 + seed * 13, T * 90 - seed * 7)
    c = base * (0.84 + 0.2 * n1 + 0.06 * (n2 - 0.5))[..., None]
    c = mix(c, c * 0.72, sstep(0.78, 0.9, grit) * 0.7)            # dark aggregate
    c = mix(c, col(0.72, 0.70, 0.66), sstep(0.2, 0.08, grit) * 0.5)  # pale aggregate
    bug = sstep(0.83, 0.88, NZ.v(Sg * 34 + 11 + seed, T * 34 - 5)) * sstep(0.55, 0.7, n2)
    c = mix(c, c * 0.45, bug * 0.8)
    hgt = 0.0006 * (grit - 0.5) + 0.0015 * (n2 - 0.5) - 0.002 * bug
    rough = 0.9 + 0.04 * (n2 - 0.5)
    return c, rough, hgt


def paint(f, S, T):
    kind, seed = f['kind'], f['seed']
    zero = np.zeros_like(S)
    if kind in ('out', 'in'):
        th = theta_of(f, S)
        r = AO_ if kind == 'out' else AI_
        y = YC + r * np.sin(th)                                   # height above the ground (m)
        Sg = (f['s0'] + S) if kind == 'out' else (f['s0'] + f['w'] - S)
        base = CONCRETE if kind == 'out' else CONCRETE * 0.95
        c, rough, hgt = concrete(Sg, T, seed * 0.1, base)
        n1 = NZ.fbm(Sg * 0.7 + 50, T * 0.7, 3)
        zend = np.minimum(T, L - T)                                # metres from the nearer mouth
        side = np.cos(th)                                          # +1 = +x side, -1 = -x side
        if kind == 'out':
            # the mould seams on both sides and a spigot groove near each mouth
            seam = sstep(0.018, 0.0, np.abs(np.abs(side) - 1) * r) * 1.0
            groove = sstep(0.03, 0.0, np.abs(zend - 0.42))
            c = mix(c, c * 1.08, seam * 0.6)
            c = mix(c, c * 0.62, groove * 0.8)
            hgt = hgt + 0.0015 * seam - 0.004 * groove
            # lime run-off down from the crown (streaks along the angle at fixed z), strongest on the upper flanks
            flank = sstep(0.35, 0.95, np.sin(th)) * sstep(1.0, 0.75, np.sin(th))
            col_ = NZ.fbm(T * 6.0 + 3, 0.5 + seed, 2)
            streak = sstep(0.55, 0.72, col_) * sstep(0.2, 0.9, np.sin(th)) * (0.6 + 0.4 * n1)
            c = mix(c, LIME, streak * 0.35)
            c = mix(c, c * 0.8, flank * sstep(0.5, 0.7, NZ.fbm(T * 3 + 9, Sg * 0.3, 2)) * 0.5)
            # lifting anchors on the crown (two recesses) with a rust halo
            for za in (L / 2 - 2.2, L / 2 + 2.2):
                d = np.hypot(np.arctan2(np.cos(th), np.sin(th)) * r, T - za)      # arc from the crown line
                rec = sstep(0.13, 0.11, d)
                halo = sstep(0.5, 0.12, d) * (0.5 + 0.5 * NZ.fbm(Sg * 6, T * 6 + za, 2))
                c = mix(c, RUST * 0.8, halo * 0.55)
                c = mix(c, SOOT * 1.6, rec)
                hgt = hgt - 0.012 * rec
                rough = rough - 0.1 * halo
            # a stencilled class mark on both sides near the +z mouth (block glyphs, worn)
            for sgn in (-1, 1):
                a = np.abs(np.arctan2(np.sin(th), np.cos(th) * sgn))    # angle from this side's normal
                band = sstep(0.62, 0.56, a * r / 1.0) * sstep(0.02, 0.0, np.abs(T - (L - 1.6)) - 0.55)
                cell = (np.mod(T / 0.16, 1.0) < 0.7) & (np.mod(a * r / 0.2, 1.0) < 0.72)
                glyph = NZ.v(np.floor(T / 0.16) * 3.3 + sgn * 7, np.floor(a * r / 0.2) * 2.1) > 0.4
                prt = band * np.where(cell & glyph, 1.0, 0.0) * sstep(0.2, 0.45, NZ.fbm(Sg * 9, T * 9, 2))
                c = mix(c, col(0.12, 0.12, 0.12), prt * 0.8)
            # a spray-painted survey number / arrow in ochre on the +x side at mid length (the sneak route's mark)
            v = np.arctan2(np.sin(th), np.cos(th)) * r                  # arc metres above the +x side's centre line
            shaft = sstep(0.05, 0.0, np.abs(v - 0.9) - 0.05) * sstep(0.0, 0.04, T - 3.0) * sstep(0.04, 0.0, T - 5.1)
            head = sstep(0.04, 0.0, np.abs(v - 0.9) - (5.75 - T) * 0.55) * sstep(0.0, 0.04, T - 5.0) * sstep(0.04, 0.0, T - 5.75)
            arrow = np.maximum(shaft, head)
            spray = np.clip(arrow, 0, 1) * sstep(0.25, 0.5, NZ.fbm(Sg * 14, T * 14, 2) + 0.2)
            c = mix(c, OCHRE * 0.9, spray * 0.75)
            rough = rough - 0.2 * spray
            # grime low down, capillary damp from the ground, mud splash, algae in the wet lower flanks
            low = sstep(1.6, 0.2, y)
            c = mix(c, c * 0.62, low * 0.55)
            damp = sstep(0.9, 0.0, y + 0.25 * (n1 - 0.5))
            c = mix(c, c * 0.7, damp)
            splash = sstep(0.62, 0.7, NZ.fbm(Sg * 7 + 3, T * 7, 3)) * sstep(1.1, 0.2, y)
            c = mix(c, MUD, np.maximum(splash, sstep(0.35, 0.05, y)) * 0.8)
            algae = sstep(0.55, 0.68, NZ.fbm(Sg * 1.6 + 20, T * 1.6, 4)) * sstep(2.2, 0.8, y)
            c = mix(c, ALGAE, algae * 0.55)
            rough = rough - 0.25 * damp - 0.12 * algae - 0.1 * splash
        else:
            # the bore: silt along the floor with a tide line, lime drips from the crown, algae near the water line
            fl = y - (YC - AI_)                                    # height above the inner floor
            silt = sstep(0.28, 0.12, fl + 0.08 * (n1 - 0.5))
            c = mix(c, MUD * (0.9 + 0.3 * NZ.fbm(Sg * 5, T * 5, 2))[..., None], silt * 0.85)
            tide = sstep(0.03, 0.0, np.abs(fl - 0.62 - 0.08 * (n1 - 0.5)))
            c = mix(c, c * 0.55, tide * 0.7)
            below = sstep(0.7, 0.5, fl)
            c = mix(c, c * 0.75, below * 0.6)
            algae = sstep(0.5, 0.65, NZ.fbm(Sg * 2.4 + 5, T * 2.4, 3)) * sstep(1.3, 0.4, fl)
            c = mix(c, ALGAE, algae * 0.6)
            drips = sstep(0.62, 0.75, NZ.fbm(T * 7 + 1, 0.3 + seed, 2)) * sstep(0.2, 1.0, np.sin(th)) * (0.4 + 0.6 * n1)
            c = mix(c, LIME * 0.9, drips * 0.4)
            soot = sstep(0.6, 0.8, NZ.fbm(Sg * 0.8 + 70, T * 0.8, 3)) * sstep(0.3, 1.0, np.sin(th))
            c = mix(c, c * 0.6, soot * 0.5)
            # the mouths stay lighter (weathered like the outside), the middle darker (never rained on)
            c = mix(c, c * 0.85, sstep(0.8, 2.5, zend))
            rough = rough - 0.4 * silt - 0.15 * below - 0.1 * algae
            hgt = hgt + 0.002 * silt * (NZ.fbm(Sg * 9, T * 9, 2) - 0.5)
        # chipped rims at both mouths: spalls with pale exposed aggregate and a rust dot or two
        spall = sstep(0.62, 0.7, NZ.fbm(Sg * 4 + 30, T * 4, 3)) * sstep(0.35, 0.05, zend)
        c = mix(c, col(0.66, 0.63, 0.58), spall * 0.6)
        rdot = sstep(0.88, 0.92, NZ.v(Sg * 12 + 3, T * 12)) * spall
        c = mix(c, RUST, rdot)
        hgt = hgt - 0.008 * spall
        return c, rough, zero, hgt, zero
    if kind == 'end':
        # the mouth face: arc metres around (s) and radial metres out from the bore (t)
        Sg = S
        th = TH0 + (S / WF_O) * (2 * math.pi / N) * (-f['e'])
        y = YC + (RI + T) * COSH * np.sin(th)
        c, rough, hgt = concrete(Sg, T * 3, 40 + f['e'], CONCRETE)
        chips = sstep(0.55, 0.66, NZ.fbm(Sg * 5 + f['e'] * 7, T * 5, 3))
        c = mix(c, col(0.68, 0.65, 0.6), chips * 0.5)
        edge = sstep(0.06, 0.0, np.minimum(T, (RO - RI) - T))
        c = mix(c, c * 0.8, edge * 0.5)
        low = sstep(1.4, 0.2, y)
        c = mix(c, MUD, low * 0.6)
        c = mix(c, c * 0.7, sstep(0.5, 0.0, y) * 0.6)
        hgt = hgt - 0.006 * chips
        return c, rough - 0.2 * low, zero, hgt, zero
    # cap: the far-LOD mouth disc, the dark bore with a lighter rim
    d = np.hypot(S - RO, T - RO)
    c = mix(col(0.04, 0.04, 0.04), CONCRETE * 0.7, sstep(RI * 0.95, RI * 1.02, d))
    return c, 0.9 + zero, zero, zero, zero


# ------------------------------------------------------------------------------------------------ build
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    F = faces()
    px_m, rects = solve_atlas(F, ATLAS, PAD, DENSITY)
    Fid = {f['id']: f for f in F}
    print(f'atlas: {len(F)} faces, {px_m} px/m (outer)')
    alb, rough, metal, nrm, _ = paint_faces(F, rects, paint, ATLAS, PAD, CONCRETE * 0.6, 0.9)
    # the bore: the style already shuts the sky fill out of it (lotInteriors, W10 P5), so the baked tube occlusion is
    # lifted there (0.75 + 0.25 ao) or the two would crush the sneak route to black
    bore = np.zeros((ATLAS, ATLAS), bool)
    for f in F:
        if f['kind'] == 'in':
            x, y, w, h, rot = rects[f['id']]
            bore[y - PAD:y + h + PAD, x - PAD:x + w + PAD] = True
    ao_fix = lambda ao: np.where(bore, 0.75 + 0.25 * ao, ao)
    info = build_kit(NAME, lambda mat: [build_lod(i, mat, rects, Fid) for i in range(3)], colliders(), alb, rough, metal,
                     nrm, args.out, ATLAS, samples=args.samples, ao_distance=2.5, ao_floor=0.3, ao_into_albedo=0.2, pad=PAD,
                     ao_fix=ao_fix)
    info.update(px_per_m=px_m, bore_apothem=round(AI_, 4), outer_apothem=round(AO_, 4), length=L, facets=N)
    report(info, ROOT)


main()

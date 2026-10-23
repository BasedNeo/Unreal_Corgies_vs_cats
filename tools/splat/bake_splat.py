# bake_splat.py (W17 AAA pass 4 SPLAT, lane BL-DCC): the UNTRAINED backdrop splat, baked, never trained.
#
# assets/backdrop/lot_backdrop_untrained.spz: Gaussian surfels sampled on the backdrop's surfaces (backdrop.build(), the
# same code as the GLB), each coloured from the Cycles training renders of tools/blender/splat_set.py (projected into
# every non-held-out view, kept only where that view's depth render says the surfel is the visible surface, weighted by
# how square-on the view sees it). It can always ship: it needs no trainer and no AGPL tool (AAA_PLAN ruling 1, decision 1).
#
#   - budget: at most `n` (300k) splats and 15 MB. (1 - apron) of them on the backdrop's pieces (area-weighted over
#     every triangle), `apron` (0.15) on the wet apron from 165 m out to the GLB apron's edge (`apron_far`, 1500 m),
#     log-uniform in radius (spacing grows with distance, ~constant on screen; densest where the lamps' pools lie).
#     `over` x as many candidates are sampled and coloured; only candidates some training view SEES can be kept (about
#     half of the pieces' area is never seen from the play area: container bottoms, stacked faces, far sides), and the
#     budget is then drawn from the seen ones, so it goes on visible surfaces
#   - visibility: a view sees a candidate when its depth render agrees within 1 % + 1 m + the depth change across
#     1.5 pixels at that grazing angle (dist / (fy * cos)); colour weight = |cos| (min_cos 0.15; apron 0.02, since the
#     ground is only ever seen at grazing angles from eye height)
#   - surfels: two axes sigma = min(0.5 x the KEPT spacing (seen area / kept), 0.5 x the triangle's shortest edge) (thin
#     beams stay thin), the third (along the normal) 2 cm; opacity 0.95 (apron 0.9); SH degree 0 (view-independent)
#   - colour: display values of the Standard-view training renders (sRGB, no tonemap), stored as SH DC:
#     colour = 0.5 + SH_C0 * f_dc (three's GaussianSplat convention; the twin applies the colour contract of TW-SPLAT)
#   - space: GAME axes (x, y up, z; metres) = the twin's world: no 3DGS y-down flip; cropped to nothing inside
#     max(|x|, |z|) < 165 m
#   - format: SPZ v3 (Niantic; gzip, 24-bit fixed positions with `fb` fractional bits, smallest-three quaternions), the
#     layout three 0.186.1's SPZLoader reads; tools/splat/spz_check.mjs proves it in Node
#   - deterministic: numpy default_rng(seed), gzip mtime 0
# Writes <out>.spz and <out>.receipt.json (label UNTRAINED; counts, bytes, sha256, bounds, colour and space conventions,
# sample splats with the values three must decode, the training set's facts, timings, rebuild, licence).
#
# Usage (repo root; $BLENDER = Blender 5.2.2; the training set first, in scratch):
#   "$BLENDER" --background --factory-startup --python tools/blender/splat_set.py -- --out <scratch>/train
#   "$BLENDER" --background --factory-startup --python tools/splat/bake_splat.py -- --set <scratch>/train
#   node tools/splat/spz_check.mjs assets/backdrop/lot_backdrop_untrained.spz
import gzip
import json
import math
import os
import struct
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'blender'))
import bllib  # noqa: E402
import backdrop  # noqa: E402

P = bllib.args({'set': '', 'out': os.path.join('assets', 'backdrop', 'lot_backdrop_untrained'), 'n': 300000,
                'apron': 0.15, 'apron_far': float(backdrop.APRON[1]), 'crop': 165.0, 'fb': 12, 'alpha': 0.95, 'alpha_apron': 0.9,
                'min_cos': 0.15, 'min_cos_apron': 0.02, 'over': 2.0, 'samples_out': 16})
SH_C0 = 0.28209479177387814
LABEL = 'UNTRAINED'
bllib.check_blender()
clock = bllib.Clock()
if not P['set']:
    raise SystemExit('--set <the training set directory from tools/blender/splat_set.py>')
tj = json.load(open(os.path.join(P['set'], 'transforms.json')))
setrec = json.load(open(os.path.join(P['set'], 'set.receipt.json')))
B = clock.lap('build', backdrop.build)


def triangles():
    """Every backdrop triangle in game axes, split into pieces and apron."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = {'piece': [], 'apron': []}
    for o in B.coll.objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        tri = np.empty(len(me.loop_triangles) * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        ev.to_mesh_clear()
        m = np.array(o.matrix_world)
        w = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
        g = np.stack([w[:, 0], w[:, 2], -w[:, 1]], 1)                  # Blender -> game axes
        out['apron' if o.name.startswith('BD_Apron') else 'piece'].append(g[tri.reshape(-1, 3)])
    return {k: np.concatenate(v) for k, v in out.items()}


T = clock.lap('triangles', triangles)
rng = np.random.default_rng(bllib.SEED)


def sample():
    """Candidates: `over` x the budget, area-weighted on the pieces, uniform on the apron ring (normal up)."""
    tri = T['piece']
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    cr = np.cross(e1, e2)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    ok = area > 1e-8
    tri, e1, e2, cr, area = tri[ok], e1[ok], e2[ok], cr[ok], area[ok]
    n_piece = int(round(P['n'] * (1 - P['apron'])))
    c_piece = int(round(n_piece * P['over']))
    idx = rng.choice(len(tri), size=c_piece, p=area / area.sum())
    u, v = rng.random(c_piece), rng.random(c_piece)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pos = tri[idx, 0] + e1[idx] * u[:, None] + e2[idx] * v[:, None]
    nrm = cr[idx] / np.linalg.norm(cr[idx], axis=1, keepdims=True)
    edge = np.minimum(np.minimum(np.linalg.norm(e1[idx], axis=1), np.linalg.norm(e2[idx], axis=1)),
                      np.linalg.norm(tri[idx, 2] - tri[idx, 1], axis=1))
    # the apron: square rings of Chebyshev radius r, r log-uniform over [crop, apron_far] and uniform along each ring,
    # so the spacing grows with r (about constant on screen from the Lot: dense where it is close, sparse far out)
    n_ap = P['n'] - n_piece
    c_ap = int(round(n_ap * P['over']))
    lo, hi = P['crop'], P['apron_far']
    k = math.log(hi / lo)
    r = lo * np.exp(rng.random(c_ap) * k)
    t = rng.random(c_ap) * 8.0
    side, sv = np.floor(t / 2).astype(int), (t % 2.0) - 1.0
    x = np.choose(side, [sv * r, r, -sv * r, -r])
    z = np.choose(side, [-r, sv * r, r, -sv * r])
    ap = np.stack([x, np.zeros(c_ap), z], 1)
    sp_ap = r * math.sqrt(8.0 * k / c_ap)                         # candidate spacing at r (density n / (8 r^2 k))
    return {'pos': np.concatenate([pos, ap]), 'nrm': np.concatenate([nrm, np.tile([0.0, 1.0, 0.0], (c_ap, 1))]),
            'edge': np.concatenate([edge, np.full(c_ap, np.inf)]), 'sp_ap': np.concatenate([np.zeros(c_piece), sp_ap]),
            'apron': np.concatenate([np.zeros(c_piece, bool), np.ones(c_ap, bool)]),
            'budget': {'pieces': n_piece, 'apron': n_ap},
            'area': {'pieces': float(area.sum()), 'apron': (2 * hi) ** 2 - (2 * lo) ** 2},
            'facts': {'candidates_pieces': c_piece, 'candidates_apron': c_ap, 'piece_area_m2': round(float(area.sum()), 1),
                      'apron_ring_m': [lo, hi]}}


Sm = clock.lap('sample', sample)


def colour():
    pos, nrm = Sm['pos'], Sm['nrm']
    N = len(pos)
    min_cos = np.where(Sm['apron'], P['min_cos_apron'], P['min_cos'])
    acc, wsum, nviews = np.zeros((N, 3)), np.zeros(N), np.zeros(N, np.int32)
    W, H, fx, fy, cx, cyy = tj['w'], tj['h'], tj['fl_x'], tj['fl_y'], tj['cx'], tj['cy']
    used = 0
    for fr in tj['frames']:
        if fr['held_out']:
            continue
        used += 1
        c2w = np.array(fr['transform_matrix'])
        R, Tt = c2w[:3, :3], c2w[:3, 3]
        d = pos - Tt
        Xc = d @ R                                                  # camera axes (OpenGL: looks -Z)
        z = -Xc[:, 2]
        with np.errstate(divide='ignore', invalid='ignore'):
            u = cx + fx * Xc[:, 0] / z
            v = cyy - fy * Xc[:, 1] / z
        inside = (z > 0.1) & (u >= 0) & (u < W - 1) & (v >= 0) & (v < H - 1)
        ii = np.nonzero(inside)[0]
        if not len(ii):
            continue
        dist = np.linalg.norm(d[ii], axis=1)
        cos = np.abs(np.sum(nrm[ii] * (-d[ii] / dist[:, None]), axis=1))
        depth = np.load(os.path.join(P['set'], fr['depth_path'])).astype(np.float32)
        dv = depth[np.round(v[ii]).astype(int).clip(0, H - 1), np.round(u[ii]).astype(int).clip(0, W - 1)]
        tol = 0.01 * dist + 1.0 + 1.5 * dist / (fy * np.maximum(cos, 0.01))
        vis = (dv > 0) & (np.abs(dist - dv) < tol)
        ok = vis & (cos >= min_cos[ii])
        ii, cos = ii[ok], cos[ok]
        if not len(ii):
            continue
        img = bpy.data.images.load(os.path.join(P['set'], fr['file_path']), check_existing=False)
        img.colorspace_settings.name = 'Non-Color'                  # the stored display values, as a trainer reads them
        px = np.empty(W * H * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        px = px.reshape(H, W, 4)[::-1, :, :3]
        uu, vv = u[ii], v[ii]
        x0, y0 = np.floor(uu).astype(int), np.floor(vv).astype(int)
        ax, ay = (uu - x0)[:, None], (vv - y0)[:, None]
        c = (px[y0, x0] * (1 - ax) * (1 - ay) + px[y0, x0 + 1] * ax * (1 - ay) + px[y0 + 1, x0] * (1 - ax) * ay
             + px[y0 + 1, x0 + 1] * ax * ay)
        np.add.at(acc, ii, c * cos[:, None])
        np.add.at(wsum, ii, cos)
        np.add.at(nviews, ii, 1)
    return acc, wsum, nviews, used


acc, wsum, nviews, used = clock.lap('colour', colour)
seen = wsum > 0
Q = float(1 << P['fb'])                                     # crop on the STORED (fixed-point) positions
cheb = np.maximum(np.abs(np.round(Sm['pos'][:, 0] * Q)), np.abs(np.round(Sm['pos'][:, 2] * Q))) / Q
ok = seen & (cheb >= P['crop'])


def select():
    """The budget, drawn (seeded, without replacement) from the seen candidates; sigma from the kept spacing."""
    keep = np.zeros(len(ok), bool)
    st = np.zeros(len(ok))
    facts = {}
    budget_left = P['n']
    for part, mask in (('pieces', ~Sm['apron']), ('apron', Sm['apron'])):
        cand = np.nonzero(ok & mask)[0]
        want = min(len(cand), Sm['budget'][part] if part == 'pieces' else budget_left)
        pick = np.sort(rng.choice(cand, size=want, replace=False)) if want < len(cand) else cand
        keep[pick] = True
        budget_left -= len(pick)
        seen_area = Sm['area'][part] * (ok & mask).sum() / max(1, mask.sum())
        facts[part] = {'candidates': int(mask.sum()), 'seen': int((ok & mask).sum()), 'kept': int(len(pick)),
                       'seen_area_m2': round(seen_area, 1)}
        if part == 'pieces':
            spacing = math.sqrt(seen_area / max(1, len(pick)))
            st[pick] = np.minimum(0.5 * spacing, 0.5 * Sm['edge'][pick])
            facts[part]['spacing_m'] = round(spacing, 4)
        else:                                                       # the kept share of the candidates, at each r
            f = math.sqrt((ok & mask).sum() / max(1, len(pick)))
            st[pick] = 0.5 * Sm['sp_ap'][pick] * f
            facts[part]['spacing_m_at'] = {str(int(rr)): round(float(rr * math.sqrt(8.0 * math.log(P['apron_far'] / P['crop'])
                                                                       / mask.sum()) * f), 3)
                                           for rr in (P['crop'], 450.0, P['apron_far'])}
    return keep, st, facts


keep, st_all, sel = clock.lap('select', select)
pos, nrm, st = Sm['pos'][keep], Sm['nrm'][keep], st_all[keep]
alpha = np.where(Sm['apron'][keep], P['alpha_apron'], P['alpha'])
col = np.clip(acc[keep] / wsum[keep][:, None], 0, 1)
M = len(pos)


def quat_z_to(nv):
    """Quaternions (x, y, z, w) turning +Z onto each normal (the surfel's thin axis)."""
    x = np.stack([-nv[:, 1], nv[:, 0], np.zeros(len(nv))], 1)          # z x n
    w = 1.0 + nv[:, 2]
    q = np.concatenate([x, w[:, None]], 1)
    bad = w < 1e-6                                                      # n = -z: half turn about x
    q[bad] = [1.0, 0.0, 0.0, 0.0]
    return q / np.linalg.norm(q, axis=1, keepdims=True)


def encode():
    fb = P['fb']
    q = quat_z_to(nrm)
    fixed = np.round(pos * (1 << fb)).astype(np.int64)
    if np.abs(fixed).max() >= (1 << 23):
        raise SystemExit('position out of the 24-bit range: lower --fb')
    fixed &= 0xFFFFFF
    pos_b = np.stack([(fixed >> s) & 255 for s in (0, 8, 16)], -1).astype(np.uint8).reshape(M, 9)
    alpha_b = np.round(alpha * 255).astype(np.uint8)
    f_dc = (col - 0.5) / SH_C0
    col_b = np.clip(np.round((f_dc * 0.15 + 0.5) * 255), 0, 255).astype(np.uint8)
    sig = np.stack([st, st, np.full(M, 0.02)], 1)
    scale_b = np.clip(np.round((np.log(sig) + 10) * 16), 0, 255).astype(np.uint8)
    L = np.argmax(np.abs(q), axis=1)
    sign = np.where(q[np.arange(M), L] < 0, -1.0, 1.0)
    q = q * sign[:, None]
    rot = (L.astype(np.uint32) << 30)
    rest = np.array([[j for j in range(4) if j != l] for l in range(4)])[L]      # ascending: c, b, a
    for k, shift in zip(range(3), (20, 10, 0)):
        comp = q[np.arange(M), rest[:, k]]
        mag = np.clip(np.round(np.abs(comp) / math.sqrt(0.5) * 511), 0, 511).astype(np.uint32)
        rot |= (mag | np.where(comp < 0, 512, 0).astype(np.uint32)) << shift
    hdr = struct.pack('<IIIBBBB', 0x5053474E, 3, M, 0, fb, 0, 0)
    raw = hdr + pos_b.tobytes() + alpha_b.tobytes() + col_b.tobytes() + scale_b.tobytes() + rot.astype('<u4').tobytes()
    os.makedirs(os.path.dirname(os.path.abspath(P['out'])), exist_ok=True)
    with open(P['out'] + '.spz', 'wb') as f:
        f.write(gzip.compress(raw, compresslevel=9, mtime=0))
    # sample splats: what three's SPZLoader must decode, worked out from the STORED bytes the way it does (int24
    # positions; colour bytes through its COLOR_LUT, a Uint8ClampedArray, so round-half-even and clamp; the
    # smallest-three quaternion with its largest component rebuilt, normalised; covariance R S^2 R^T)
    pick = np.linspace(0, M - 1, P['samples_out']).astype(int)
    samples = []
    qlut = lambda c: (-1 if c & 512 else 1) * math.sqrt(0.5) * ((c & 511) / 511)  # noqa: E731
    for i in pick:
        cb = [int(np.clip(np.round(((int(b) / 255 - 0.5) * (SH_C0 / 0.15) + 0.5) * 255), 0, 255)) for b in col_b[i]]
        s = np.exp(scale_b[i].astype(np.float64) / 16 - 10)
        packed = int(rot[i])
        lg = packed >> 30
        a, b_, c_ = qlut(packed & 1023), qlut((packed >> 10) & 1023), qlut((packed >> 20) & 1023)
        qd = [0.0] * 4
        others = [j for j in range(4) if j != lg]
        qd[others[0]], qd[others[1]], qd[others[2]] = c_, b_, a
        qd[lg] = math.sqrt(max(0.0, 1 - (a * a + b_ * b_ + c_ * c_)))
        x, y, z, w = np.array(qd) / np.linalg.norm(qd)
        p24 = [int(pos_b[i, 3 * k]) | int(pos_b[i, 3 * k + 1]) << 8 | int(pos_b[i, 3 * k + 2]) << 16 for k in range(3)]
        pdec = [(v - (1 << 24) if v & 0x800000 else v) / (1 << fb) for v in p24]
        Rm = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                       [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                       [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        cov = Rm @ np.diag(s * s) @ Rm.T
        samples.append({'index': int(i), 'position': pdec, 'color_rgba': cb + [int(alpha_b[i])],
                        'covariance': [float(cov[0, 0]), float(cov[0, 1]), float(cov[0, 2]), float(cov[1, 1]), float(cov[1, 2]), float(cov[2, 2])]})
    return len(raw), samples


raw_bytes, samples = clock.lap('encode', encode)
spz = bllib.facts(P['out'] + '.spz', splats=M, sh_degree=0, version=3, fractional_bits=P['fb'], decompressed_bytes=raw_bytes,
                  label=LABEL)


def scratch_name(path):
    """A path outside the repo (the scratch training set, a scratch --out) as <scratch>/<last part>: receipts never
    carry one machine's or one session's absolute paths."""
    a = os.path.abspath(path)
    return bllib.rel(a) if a.startswith(bllib.ROOT + os.sep) else '<scratch>/' + os.path.basename(a.rstrip(os.sep))


def scrub(v):
    if isinstance(v, dict):
        return {k: scrub(x) for k, x in v.items()}
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, str):
        for raw in sorted({P['set'], os.path.abspath(P['set']), P['out'], os.path.abspath(P['out'])}, key=len, reverse=True):
            if raw and not os.path.abspath(raw).startswith(bllib.ROOT + os.sep) and raw in v:
                v = v.replace(raw, scratch_name(raw))
    return v


rec = bllib.write_receipt(
    P['out'] + '.receipt.json', __file__, outputs={'spz': spz}, params=P, clock=clock, kind=f'SPLAT: baked, {LABEL}',
    label=LABEL,
    limits={'splats_max': 300000, 'bytes_max': 15 * 1000 * 1000, 'min_cheb_m': P['crop']},
    stats={'candidates': len(Sm['pos']), 'seen': int(seen.sum()), 'kept': M, 'dropped_unseen': int((~seen).sum()),
           'dropped_inside_crop': int((seen & (cheb < P['crop'])).sum()), 'apron_kept': int(Sm['apron'][keep].sum()),
           'by_part': sel, 'views_per_splat_median': int(np.median(nviews[keep])),
           'min_cheb_m': round(float(cheb[keep].min()), 3),
           'max_dist_m': round(float(np.linalg.norm(pos[:, [0, 2]], axis=1).max()), 1),
           'bounds_min': [round(float(v), 2) for v in pos.min(0)], 'bounds_max': [round(float(v), 2) for v in pos.max(0)],
           'sigma_m': {'median': round(float(np.median(st)), 4), 'max': round(float(st.max()), 4)},
           'mean_colour': [round(float(v), 4) for v in col.mean(0)], **Sm['facts']},
    conventions={'space': 'game axes: x, y up, z (metres) = the twin world; no 3DGS y-down flip',
                 'colour': 'display values (sRGB) of the Standard-view training renders; SPZ SH DC, colour = 0.5 + SH_C0 * f_dc',
                 'sh_degree': 0, 'opacity': [P['alpha'], P['alpha_apron']], 'surfel_normal_sigma_m': 0.02,
                 'visibility': 'depth agrees within 1 % + 1 m + 1.5 px of depth slope; weight |cos|, min_cos 0.15 (apron 0.02)'},
    training_set={'path_scratch': scratch_name(P['set']), 'views': len(tj['frames']), 'views_used_for_colour': used,
                  'splat_set_script': 'tools/blender/splat_set.py',
                  'splat_set_script_sha256': bllib.sha256(os.path.join(bllib.ROOT, 'tools', 'blender', 'splat_set.py')),
                  'rendered_by_script_sha256': setrec['script_sha256'],
                  'held_out': len([f for f in tj['frames'] if f['held_out']]), 'size': [tj['w'], tj['h']],
                  'spp': setrec['params']['spp'], 'transforms_sha256': setrec['transforms_sha256'],
                  'rebuild': '"$BLENDER" --background --factory-startup --python tools/blender/splat_set.py -- --out <scratch>/train',
                  'timing': setrec['timing']},
    sources={'backdrop_glb_sha256': bllib.sha256(os.path.join(bllib.ROOT, 'assets', 'backdrop', 'lot_backdrop.glb')),
             'backdrop_script_sha256': bllib.sha256(os.path.join(bllib.ROOT, 'tools', 'blender', 'backdrop.py')),
             'sky_sha256': bllib.sha256(os.path.join(bllib.ROOT, backdrop.SKY))},
    samples=samples,
    fine_tune='NOT RUN: OpenSplat (AGPL-3.0) waits on the owner sign-off (AAA_PLAN decision 1); tools/splat/build_opensplat.sh is a recipe only',
)
rec = scrub(rec)                                            # no absolute scratch paths (params, rebuild, set path)
with open(P['out'] + '.receipt.json', 'w', encoding='utf8') as f:
    json.dump(rec, f, indent=1)
    f.write('\n')
print('SPZ', spz['sha256'], 'bytes', spz['bytes'], 'splats', M, 'stats', json.dumps(rec['stats']))

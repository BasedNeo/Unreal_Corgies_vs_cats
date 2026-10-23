# wet_mask.py (W17 AAA pass 2 WET, lane BL-DCC): the Lot asphalt's wet mask, one PNG both engines sample.
#
# assets/lot/lot_wet_mask.png, 2048 x 2048, 8-bit RGB, non-colour data:
#   R puddle  standing water: a priority-flood depression fill (Barnes et al. 2014) of the Lot heights (upsampled to
#             0.5 m, plus seeded 4 cm micro-relief), each basin's water capped `cap` m above its local floor, so pits and
#             shallow yard basins hold puddles in their lowest spots instead of turning into lakes; only on flat ground;
#             kept off cover feet (`clear` m around every ground-standing sim collider of the_lot.json, ramping back in
#             over `clear_soft` m) and out of the ditches (their water zones are water already)
#   G damp    the sheen everywhere else: broad seeded patches, wetter on flat ground, always 1 under and around puddles
#   B glint   the floods' pools: around each flood's target (the_lot.json floodlights[].target), strongest on water
# The West Yard is not on the mask: every channel is 0 on the outer side of the Lot's west fence line (the_lot.json fences[]),
# so the yard beyond it stays dirt; every texel whose whole cell lies beyond the line is set to exactly 0 after the render
# (the 1 px filter would otherwise bleed a few /255 into the last column). Everything is read from engines/godot/data/the_lot.json, nothing is typed.
#
# World alignment (in the receipt, `transform`): the image spans the world bounds (the_lot.json bounds, +-156 m).
# Texel (u, v), u to the right and v DOWN the image (row 0 = top), has its centre at game
#   x = minX + (u + 0.5) * m_per_texel,   z = minZ + (v + 0.5) * m_per_texel,   m_per_texel = (maxX - minX) / 2048
# so the top-left texel is the bounds' (minX, minZ) corner, image right = game +X, image down = game +Z. A shader takes
# uv = ((x - minX) / (maxX - minX), (z - minZ) / (maxZ - minZ)) with v = 0 at the top row (Godot's UV origin; three.js
# textures need flipY = false for the same uv).
#
# Rendering: the mask is a grid mesh carrying the numpy fields as attributes, shaded by an emission material (seeded
# 3D noise breaks the puddle edges below the 0.5 m grid), rendered top-down by an orthographic Cycles camera at 16 spp
# (anti-aliasing only: no lights, no bounces, no denoiser, no adaptive sampling). The render goes through
# bllib.render_exr (no metadata), is quantised once in numpy and saved as an 8-bit non-colour PNG: two runs, same bytes.
#
# Usage (repo root; $BLENDER = the Blender 5.2.2 binary; defaults = the product):
#   "$BLENDER" --background --factory-startup --python tools/blender/wet_mask.py
#   "$BLENDER" --background --factory-startup --python tools/blender/wet_mask.py -- --res 512 --spp 4 --out <scratch>/look
import heapq
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bllib  # noqa: E402

P = bllib.args({
    'out': os.path.join('assets', 'lot', 'lot_wet_mask'),
    'res': 2048, 'spp': 16, 'threads': 4,
    'sub': 2,           # grid subdivision of the 1 m heights (2 = 0.5 m)
    'cap': 0.025,       # water depth cap above the basin's local floor (m): 0.05 flooded the corgi pit's flat floor
    'floor_r': 6.0,     # local-floor window radius (m)
    'micro': 0.05,      # seeded micro-relief amplitude (m): where water collects on "flat" asphalt
    'slope': 0.2,       # slope (rise / run) above which ground counts as not flat
    'clear': 1.5,       # no puddle within this distance (m) of a cover collider's footprint ...
    'clear_soft': 3.0,  # ... ramping back to full over this distance
    'glint_r': 22.0,    # flood pool radius (m, Gaussian sigma) around each flood target
})
OUT, RES = P['out'], P['res']
PERIMETER = ('hoarding', 'boundary', 'fence')     # perimeter walls are not cover

bllib.check_blender()
clock = bllib.Clock()
lot = bllib.lot()
B = bllib.bounds(lot)
tr = lot['terrain']
n, x0, z0, cell = tr['n'], tr['x0'], tr['z0'], tr['cell']


def fields():
    """The numpy half: heights -> depth, flat, cover clearance, glint, west-yard and water masks on the 0.5 m grid."""
    h = bllib.heights(lot)                                         # h[j, i] at (x0 + i cell, z0 + j cell)
    S = P['sub']
    m = (n - 1) * S + 1
    u = np.linspace(0, n - 1, m)
    i0 = np.clip(np.floor(u).astype(int), 0, n - 2)
    f = u - i0
    hr = (h[i0][:, i0] * (1 - f)[None, :] + h[i0][:, i0 + 1] * f[None, :]) * (1 - f)[:, None] + \
         (h[i0 + 1][:, i0] * (1 - f)[None, :] + h[i0 + 1][:, i0 + 1] * f[None, :]) * f[:, None]
    rng = np.random.default_rng(bllib.SEED)

    def value_noise(period):
        g = rng.random((m // period + 3, m // period + 3))
        t = np.arange(m) / period
        k = t.astype(int)
        fr = t - k
        s = fr * fr * (3 - 2 * fr)
        a = g[k][:, k] * (1 - s)[None, :] + g[k][:, k + 1] * s[None, :]
        b = g[k + 1][:, k] * (1 - s)[None, :] + g[k + 1][:, k + 1] * s[None, :]
        return a * (1 - s)[:, None] + b * s[:, None]

    micro = sum(value_noise(p) * w for p, w in ((24 * S, 0.45), (12 * S, 0.3), (4 * S, 0.25)))
    micro = (micro - micro.mean()) / (micro.std() + 1e-9) * (P['micro'] / 2.0)
    z = hr + micro
    # priority flood from the grid boundary
    filled = z.tolist()
    done = np.zeros((m, m), bool)
    pq = []
    for jj in range(m):
        for ii in (0, m - 1):
            heapq.heappush(pq, (z[jj, ii], jj, ii))
            done[jj, ii] = True
    for ii in range(1, m - 1):
        for jj in (0, m - 1):
            heapq.heappush(pq, (z[jj, ii], jj, ii))
            done[jj, ii] = True
    dn = done.tolist()
    while pq:
        c, jj, ii = heapq.heappop(pq)
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = jj + dj, ii + di
            if 0 <= a < m and 0 <= b < m and not dn[a][b]:
                dn[a][b] = True
                v = filled[a][b]
                if v < c:
                    v = c
                    filled[a][b] = c
                heapq.heappush(pq, (v, a, b))
    filled = np.array(filled)
    floor = z.copy()
    r = int(round(P['floor_r'] * S / cell))
    for ax in (0, 1):
        src = floor.copy()
        for d in range(1, r + 1):
            floor = np.minimum(floor, np.roll(src, d, axis=ax))
            floor = np.minimum(floor, np.roll(src, -d, axis=ax))
    depth = np.clip(np.minimum(filled, floor + P['cap']) - z, 0.0, None)
    gy, gx = np.gradient(hr, cell / S)
    flat = np.clip(1.0 - np.hypot(gx, gy) / P['slope'], 0.0, 1.0)
    xs = x0 + np.arange(m) * cell / S
    zs = z0 + np.arange(m) * cell / S
    XX, ZZ = np.meshgrid(xs, zs)

    # cover feet: distance to every ground-standing collider's footprint (rotated boxes, cylinders)
    def ground(x, z_):
        i = int(np.clip(round((x - x0) / cell), 0, n - 1))
        j = int(np.clip(round((z_ - z0) / cell), 0, n - 1))
        return h[j, i]

    dist = np.full((m, m), 1e9)
    reach = P['clear'] + P['clear_soft']
    bf = lot['colliders']['boxFields']
    covers = 0
    for row in lot['colliders']['boxes']:
        c = dict(zip(bf, row))
        if c['type'] in PERIMETER or c['y'] - c['hy'] > ground(c['x'], c['z']) + 0.5:
            continue
        covers += 1
        rad = math.hypot(c['hx'], c['hz']) + reach
        win = (np.abs(XX - c['x']) <= rad) & (np.abs(ZZ - c['z']) <= rad)
        dx, dz = XX[win] - c['x'], ZZ[win] - c['z']
        cs, sn = math.cos(c['yaw']), math.sin(c['yaw'])
        lx, lz = dx * cs - dz * sn, dx * sn + dz * cs                # into the box's frame (yaw about +Y)
        ex, ez = np.maximum(np.abs(lx) - c['hx'], 0), np.maximum(np.abs(lz) - c['hz'], 0)
        dist[win] = np.minimum(dist[win], np.hypot(ex, ez))
    cf = lot['colliders']['cylinderFields']
    for row in lot['colliders']['cylinders']:
        c = dict(zip(cf, row))
        if c['y'] - c['hh'] > ground(c['x'], c['z']) + 0.5:
            continue
        covers += 1
        rad = c['r'] + reach
        win = (np.abs(XX - c['x']) <= rad) & (np.abs(ZZ - c['z']) <= rad)
        dist[win] = np.minimum(dist[win], np.maximum(np.hypot(XX[win] - c['x'], ZZ[win] - c['z']) - c['r'], 0))
    t = np.clip((dist - P['clear']) / P['clear_soft'], 0, 1)
    clearance = t * t * (3 - 2 * t)

    # the West Yard: the outer side of each fence line (face = the side the yard is on), the whole half-plane, so the
    # corners beyond the hoarding on that side stay dry too
    yard = np.zeros((m, m), bool)
    for fr_ in lot['fences']:
        if fr_['x0'] == fr_['x1']:                                   # a line along z at x = x0
            yard |= (XX - fr_['x0']) * fr_['face'] >= 0           # the line itself too: the 0.5 m ramp lies inside
        else:                                                        # a line along x at z = z0
            yard |= (ZZ - fr_['z0']) * fr_['face'] >= 0
    water = np.zeros((m, m), bool)
    for w in lot['water']:
        water |= (np.abs(XX - w['x']) <= w['hx']) & (np.abs(ZZ - w['z']) <= w['hz'])
    glint = np.zeros((m, m))
    for fl in lot['floodlights']:
        tx, _, tz = fl['target']
        glint = np.maximum(glint, np.exp(-((XX - tx) ** 2 + (ZZ - tz) ** 2) / (2 * P['glint_r'] ** 2)))
    keep = (~yard).astype(float)
    return {'hr': hr, 'XX': XX, 'ZZ': ZZ, 'm': m,
            'attrs': {'depth': depth * clearance * (~water), 'flat': flat, 'glint': glint * keep, 'keep': keep,
                      'water': water.astype(float)},
            'facts': {'covers': covers, 'grid': f'{m}x{m} at {cell / S} m',
                      'cells_depth_gt_1cm': round(float((depth > 0.01).mean()), 4),
                      'cells_cleared_by_cover': round(float(((depth > 0.01) & (clearance < 0.5)).mean()), 4),
                      'cells_west_yard': round(float(yard.mean()), 4)}}


F = clock.lap('fields', fields)


def scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    m = F['m']
    me = bpy.data.meshes.new('LotGround')
    verts = np.stack([F['XX'].ravel(), -F['ZZ'].ravel(), F['hr'].ravel()], 1).astype(np.float32)
    ii, jj = np.meshgrid(np.arange(m - 1), np.arange(m - 1))
    a = (jj * m + ii).ravel()
    quads = np.stack([a, a + 1, a + m + 1, a + m], 1).astype(np.int32)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set('vertex_index', quads.ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set('loop_start', np.arange(0, quads.size, 4, dtype=np.int32))
    me.update(calc_edges=True)
    for name, arr in F['attrs'].items():
        at = me.attributes.new(name, 'FLOAT', 'POINT')
        at.data.foreach_set('value', arr.ravel().astype(np.float32))
    ob = bpy.data.objects.new('LotGround', me)
    sc.collection.objects.link(ob)
    mat = bpy.data.materials.new('WetMask')
    N, Lk = mat.node_tree.nodes, mat.node_tree.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')

    def attr(name):
        x = N.new('ShaderNodeAttribute')
        x.attribute_type = 'GEOMETRY'
        x.attribute_name = name
        return x.outputs['Fac']

    def op(o, *args):
        q = N.new('ShaderNodeMath')
        q.operation = o
        for k, v in enumerate(args):
            if isinstance(v, (int, float)):
                q.inputs[k].default_value = v
            else:
                Lk.new(v, q.inputs[k])
        return q.outputs[0]

    geo = N.new('ShaderNodeNewGeometry')

    def noise(scale, detail):
        nz = N.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Roughness'].default_value = 0.6
        Lk.new(geo.outputs['Position'], nz.inputs['Vector'])
        return nz.outputs['Fac']

    def smooth(x, e0, e1):
        q = N.new('ShaderNodeMapRange')
        q.interpolation_type = 'SMOOTHSTEP'
        q.inputs['From Min'].default_value, q.inputs['From Max'].default_value = e0, e1
        Lk.new(x, q.inputs['Value'])
        return q.outputs['Result']

    keep = attr('keep')
    dep = op('MULTIPLY_ADD', op('SUBTRACT', noise(1.6, 3.0), 0.5), 0.012, attr('depth'))   # +-6 mm edge breakup
    R = op('MULTIPLY', op('MULTIPLY', smooth(dep, 0.004, 0.014), smooth(attr('flat'), 0.2, 0.6)), keep)
    damp = op('MULTIPLY', smooth(noise(0.03, 3.0), 0.32, 0.60), op('MULTIPLY_ADD', attr('flat'), 0.4, 0.6))
    G = op('MULTIPLY', op('MAXIMUM', op('MAXIMUM', damp, smooth(attr('depth'), 0.0, 0.004)), attr('water')), keep)
    Bc = op('MULTIPLY', attr('glint'), op('MULTIPLY_ADD', R, 0.7, 0.3))
    comb = N.new('ShaderNodeCombineColor')
    for k, v in enumerate((R, G, Bc)):
        Lk.new(v, comb.inputs[k])
    em = N.new('ShaderNodeEmission')
    Lk.new(comb.outputs[0], em.inputs['Color'])
    Lk.new(em.outputs[0], out.inputs['Surface'])
    me.materials.append(mat)
    span = B['maxX'] - B['minX']
    cd = bpy.data.cameras.new('Top')
    cd.type = 'ORTHO'
    cd.ortho_scale = span
    cd.clip_end = 1000.0
    cam = bpy.data.objects.new('Top', cd)
    cam.location = ((B['minX'] + B['maxX']) / 2, -(B['minZ'] + B['maxZ']) / 2, 200.0)   # looks down: image up = game -Z
    sc.collection.objects.link(cam)
    sc.camera = cam
    w = bpy.data.worlds.new('Black')
    w.node_tree.nodes.clear()
    bg = w.node_tree.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.0
    w.node_tree.links.new(bg.outputs[0], w.node_tree.nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
    sc.world = w
    cy = bllib.cycles(sc, P['spp'], threads=P['threads'], denoise=False)
    cy.use_adaptive_sampling = False
    cy.max_bounces = 0
    sc.render.filter_size = 1.0
    sc.render.resolution_x = sc.render.resolution_y = RES
    bllib.view(sc, 'Standard')
    return sc


sc = clock.lap('scene', scene)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
tmp = os.path.abspath(OUT) + '.render.exr'
img = bllib.render_exr(sc, tmp, clock)                              # linear values, no metadata
px = np.empty(RES * RES * 4, np.float32)
img.pixels.foreach_get(px)
q = np.round(np.clip(px.reshape(RES, RES, 4)[..., :3], 0, 1) * 255)  # quantise once
os.remove(tmp)


def yard_texels():
    """Texels whose whole cell lies on the West Yard side of a fence line (rows top first): exactly 0 in every channel.
    The render's 1 px filter bleeds the last few /255 across the line; the locked rule is 'the West Yard stays dirt'."""
    mpt_ = (B['maxX'] - B['minX']) / RES
    lo_x = B['minX'] + np.arange(RES) * mpt_                        # cell edges along u (game x) and v (game z)
    lo_z = B['minZ'] + np.arange(RES) * mpt_
    m_ = np.zeros((RES, RES), bool)
    for fr_ in lot['fences']:
        if fr_['x0'] == fr_['x1']:
            col = (lo_x + mpt_ <= fr_['x0']) if fr_['face'] < 0 else (lo_x >= fr_['x0'])
            m_ |= col[None, :]
        else:
            row = (lo_z + mpt_ <= fr_['z0']) if fr_['face'] < 0 else (lo_z >= fr_['z0'])
            m_ |= row[:, None]
    return m_


yard_px = yard_texels()
q_top = q[::-1]                                                     # a view: rows top first
yard_bleed = int((q_top[yard_px] > 0).any(axis=1).sum())          # texels the render left non-zero there
q_top[yard_px] = 0
im8 = bpy.data.images.new('lot_wet_mask', RES, RES, alpha=False, float_buffer=False)
im8.colorspace_settings.name = 'Non-Color'
rgba = np.ones((RES, RES, 4), np.float32)
rgba[..., :3] = q / 255.0
im8.pixels.foreach_set(rgba.ravel())
im8.filepath_raw = os.path.abspath(OUT + '.png')
im8.file_format = 'PNG'
im8.save()

top = q[::-1]                                                       # rows top first (Blender pixels are bottom-up)
cov = {}
for k, ch in enumerate('RGB'):
    c = top[..., k] / 255.0
    cov[ch] = {'mean': round(float(c.mean()), 4), 'gt_0_5_pct': round(float((c > 0.5).mean() * 100), 2),
               'gt_0_1_pct': round(float((c > 0.1).mean() * 100), 2)}
mpt = (B['maxX'] - B['minX']) / RES
rec = bllib.write_receipt(
    OUT + '.receipt.json', __file__,
    outputs={'png': bllib.facts(OUT + '.png', width=RES, height=RES, encoding='PNG 8-bit RGB, non-colour data',
                                channels={'R': 'puddle', 'G': 'damp', 'B': 'glint'})},
    params=P, clock=clock, kind='SOURCE: wet mask',
    render={'engine': 'Cycles CPU', 'spp': P['spp'], 'seed': bllib.SEED, 'adaptive': False, 'denoiser': None,
            'threads': P['threads'], 'bounces': 0, 'filter_px': 1.0, 'camera': 'orthographic, top-down, image up = game -Z'},
    world_data={**lot['_source'], 'bounds': B, 'terrain_sha256': tr['sha256'], 'fences': lot['fences'],
                'water_zones': [w['id'] for w in lot['water']], 'flood_targets': {f['id']: f['target'] for f in lot['floodlights']}},
    transform={'source': 'the_lot.json bounds', 'origin_game_xz': [B['minX'], B['minZ']], 'span_m': [B['maxX'] - B['minX'], B['maxZ'] - B['minZ']],
               'm_per_texel': mpt, 'u_axis': 'game +X (image right)', 'v_axis': 'game +Z (image down; row 0 = top = minZ)',
               'texel_centre': f'x = {B["minX"]} + (u + 0.5) * {mpt}; z = {B["minZ"]} + (v + 0.5) * {mpt}',
               'shader_uv': 'uv = ((x - minX) / (maxX - minX), (z - minZ) / (maxZ - minZ)), v = 0 at the top row'},
    coverage={**cov, 'rule': 'per channel over all texels: mean, and % of texels above 0.5 and above 0.1'},
    fields=F['facts'],
    west_yard={'rule': 'every texel whose whole cell lies on the yard side of a fence line (the_lot.json fences[]) is 0 in '
                       'every channel, set in numpy after quantising', 'texels': int(yard_px.sum()),
               'columns_u': [int(c) for c in np.nonzero(yard_px.any(axis=0))[0][[0, -1]]] if yard_px.any() else [],
               'zeroed_from_render_bleed': yard_bleed},
    licence_note='derived from the project\'s own world data (the_lot.json); no third-party content',
)
print('WET', rec['outputs']['png']['sha256'], 'coverage', cov, 'render', clock.laps['render'])

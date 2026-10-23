# backdrop_glb.py (W17 AAA pass 4 BACKDROP, lane BL-DCC): builds the backdrop (backdrop.py) and exports it as ONE GLB,
# assets/backdrop/lot_backdrop.glb, for Godot and the twin's low / medium tiers, then fresh-imports it into an empty
# scene and writes assets/backdrop/lot_backdrop.receipt.json.
#
# The GLB: +Y up, metres (glTF), one root node Backdrop_Lot_01 (no transform) with one mesh per material family, so
# draws = materials <= 8: the six kit materials, BD_DarkSteel (cranes, gantries, the apron), BD_SodiumLamp (emissive lamp
# cards; KHR_materials_emissive_strength). No COL_ nodes, no lights, no cameras. Kit textures scaled to 256^2 PNG (the
# nearest kit piece is 216 m away: a 24 m container covers under 100 px of the 1280 x 720 hero frame).
# Checked before export, per object, on every vertex: kit pieces and lamp cards at max(|x|, |z|) >= 216 m; crane and
# gantry steel 400-900 m from the centre; the apron from 165 m. After the fresh import: nothing inside |x|, |z| < 165 m,
# no COL_ node, draws and triangles counted.
#
# The exported file goes through tools/blender/glb_weld.mjs (node; lossless: unread UVs dropped, identical vertices welded).
# The receipt's `limits` (nearest vertex, draws, texture size) are what validate-glb.mjs --backdrop checks.
#
# Usage (repo root; $BLENDER = Blender 5.2.2; defaults = the product):
#   "$BLENDER" --background --factory-startup --python tools/blender/backdrop_glb.py
import json
import math
import os
import struct
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bllib  # noqa: E402
import backdrop  # noqa: E402

P = bllib.args({'out': os.path.join('assets', 'backdrop', 'lot_backdrop'), 'tex': 256})
OUT = P['out']
ROOT_NAME = 'Backdrop_Lot_01'
bllib.check_blender()
clock = bllib.Clock()
B = clock.lap('build', backdrop.build)
sc = B.sc


def world_xyz(o):
    """Every vertex of an object (modifiers applied) in game axes: (x, y up, z)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    m = np.array(o.matrix_world)
    w = co @ m[:3, :3].T + m[:3, 3]
    return np.stack([w[:, 0], w[:, 2], -w[:, 1]], 1)


def checks():
    objs = [o for o in B.coll.objects if o.type == 'MESH']
    bad, rep = [], {'kit_and_lamps_min_cheb_m': 1e9, 'steel_dist_m': [1e9, 0.0], 'apron_min_cheb_m': 1e9, 'objects': len(objs)}
    for o in objs:
        v = world_xyz(o)
        cheb = np.maximum(np.abs(v[:, 0]), np.abs(v[:, 2]))
        dist = np.hypot(v[:, 0], v[:, 2])
        if o.name.startswith('BD_Apron'):
            rep['apron_min_cheb_m'] = min(rep['apron_min_cheb_m'], float(cheb.min()))
            if cheb.min() < 165.0 - 1e-3:
                bad.append(f'{o.name}: apron inside 165 m')
        elif o.name.startswith('BD_Steel'):
            rep['steel_dist_m'] = [min(rep['steel_dist_m'][0], float(dist.min())), max(rep['steel_dist_m'][1], float(dist.max()))]
            if dist.min() < backdrop.FAR_LO or dist.max() > backdrop.FAR_HI:
                bad.append(f'{o.name}: steel at {dist.min():.1f}-{dist.max():.1f} m (want {backdrop.FAR_LO:.0f}-{backdrop.FAR_HI:.0f})')
        else:
            rep['kit_and_lamps_min_cheb_m'] = min(rep['kit_and_lamps_min_cheb_m'], float(cheb.min()))
            if cheb.min() < backdrop.NEAR:
                bad.append(f'{o.name}: at max(|x|,|z|) = {cheb.min():.1f} m (< {backdrop.NEAR:.0f})')
    rep = {k: (round(v, 2) if isinstance(v, float) else [round(x, 2) for x in v] if isinstance(v, list) else v) for k, v in rep.items()}
    if bad:
        raise SystemExit('BACKDROP RULES FAILED:\n  ' + '\n  '.join(bad[:20]))
    return rep


rules = clock.lap('checks', checks)


def join_and_export():
    for img in bpy.data.images:                          # the kit textures (the only images)
        if img.size[0] > P['tex']:
            img.scale(P['tex'], P['tex'])
    for o in list(sc.objects):                           # export only the backdrop
        if o.name not in B.coll.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    objs = list(B.coll.objects)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.convert(target='MESH')                # applies the lattice wireframes
    groups = {}
    for o in B.coll.objects:
        groups.setdefault(o.material_slots[0].material.name, []).append(o)
    root = bpy.data.objects.new(ROOT_NAME, None)
    B.coll.objects.link(root)
    for name in sorted(groups):
        obs = groups[name]
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = j.data.name = 'BD_' + name.replace('M_Kit_Lot_', '').replace('BD_', '')
        j.parent = root
    for o in B.coll.objects:
        o.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    raw = os.path.abspath(OUT + '.raw.glb')
    bpy.ops.export_scene.gltf(filepath=raw, export_format='GLB', use_selection=True,
                              export_apply=True, export_lights=False, export_cameras=False, export_yup=True,
                              export_extras=False, export_image_format='AUTO')
    # the lossless size pass (glb_weld.mjs: drop unread UVs, weld identical vertices, dedup, prune)
    import subprocess
    res = subprocess.run(['node', os.path.join(bllib.ROOT, 'tools', 'blender', 'glb_weld.mjs'), raw, os.path.abspath(OUT + '.glb')],
                         cwd=bllib.ROOT, capture_output=True, text=True, check=True)
    weld = json.loads(next(l for l in res.stdout.splitlines() if l.startswith('WELD '))[5:])
    os.remove(raw)
    return sorted(groups), weld


families, weld = clock.lap('export', join_and_export)


def fresh_import():
    d = open(OUT + '.glb', 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    js = json.loads(d[20:20 + jl])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(OUT + '.glb'))
    tris, cheb_min, names, mats = 0, 1e9, [], set()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        names.append(o.name)
        if o.type != 'MESH':
            continue
        mats.update(s.material.name for s in o.material_slots if s.material)
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
        v = world_xyz(o)
        cheb_min = min(cheb_min, float(np.maximum(np.abs(v[:, 0]), np.abs(v[:, 2])).min()))
    prims = sum(len(m['primitives']) for m in js.get('meshes', []))
    return {'gltf': {'nodes': [n.get('name') for n in js.get('nodes', [])], 'meshes': len(js.get('meshes', [])), 'primitives_draws': prims,
                     'materials': [m['name'] for m in js.get('materials', [])], 'images': len(js.get('images', [])),
                     'extensionsUsed': js.get('extensionsUsed', []), 'asset': js.get('asset', {})},
            'fresh_import': {'objects': len(names), 'col_nodes': [n for n in names if n.startswith('COL_')], 'materials': sorted(mats),
                             'triangles': tris, 'min_cheb_m': round(cheb_min, 2), 'ok': True}}


fi = clock.lap('fresh_import', fresh_import)
glb = bllib.facts(OUT + '.glb', up='+Y', units='metres', root=ROOT_NAME, draws=fi['gltf']['primitives_draws'],
                  triangles=fi['fresh_import']['triangles'], texture_px=P['tex'])
rec = bllib.write_receipt(
    OUT + '.receipt.json', __file__, outputs={'glb': glb}, params=P, clock=clock, kind='BACKDROP: glb',
    build={'script': 'tools/blender/backdrop.py', 'script_sha256': bllib.sha256(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backdrop.py')),
           'kits': backdrop.KITS, 'masters_sha256': {k: bllib.sha256(os.path.join(bllib.ROOT, 'assets', 'masters', k + '.glb')) for k in backdrop.KITS},
           'near_m': backdrop.NEAR, 'cranes_m': [backdrop.FAR_LO, backdrop.FAR_HI], 'apron_m': list(backdrop.APRON), **B.facts},
    families=families, rules=rules,
    weld={**weld, 'script': 'tools/blender/glb_weld.mjs',
          'script_sha256': bllib.sha256(os.path.join(bllib.ROOT, 'tools', 'blender', 'glb_weld.mjs'))}, **fi,
    limits={'min_cheb_m': backdrop.APRON[0], 'draws_max': 8, 'texture_max_px': 1024},
    world_data={**B.lot['_source'], 'obstacles_beyond_165m': len(B.obstacles), 'west_fence_x': B.west},
)
print('GLB', glb['sha256'], 'bytes', glb['bytes'], 'draws', glb['draws'], 'tris', glb['triangles'], 'rules', rules, 'min_cheb', fi['fresh_import']['min_cheb_m'])

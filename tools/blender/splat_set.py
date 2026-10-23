# splat_set.py (W17 AAA pass 4 SPLAT, lane BL-DCC): the backdrop's multi-view training set, rendered from inside the
# Lot looking out. It feeds tools/splat/bake_splat.py (the UNTRAINED splat: colours projected from these renders) and,
# only after the owner's sign-off, a fine-tune (tools/splat/build_opensplat.sh is a recipe; nothing here runs it).
#
# The scene is backdrop.build() (the same code as the GLB), lit by the sky SOURCE (bllib.sky_world, the v3 EXR) and a
# sodium light at every lamp card, like backdrop.py's look views. AAA_PLAN ruling 3:
#   - the Lot is camera-invisible (here its stand-in floor, LookGround: it still takes part in the light, it is never
#     seen), so the training images hold only the backdrop and the sky;
#   - Standard view transform (no tonemap: the twin applies its own AgX), no baked haze (both engines fog live);
#   - 768 x 432 at 32 spp (39.1 dB against 128 spp in the spike), 150 views from inside the play bounds looking out.
# Views (seeded, random.Random(seed)): bearings stratified over 360 deg (view i near i * 2.4 deg), the eye anywhere in
# the play bounds (|x|, |z| <= 150 m) 1.5-20 m up, pitch -3 to +12 deg, vertical fov 50 deg. Every 10th view is marked
# held-out (for a PSNR gate later).
# Each view also gets a 1-spp depth render (camera-ray length; 0 = sky), stored as float16 .npy for the bake's
# visibility test.
#
# Output (a scratch directory, NEVER the repo): <out>/images/frame_NNNN.png (8-bit sRGB display values, Standard),
# <out>/depth/frame_NNNN.npy, <out>/transforms.json (nerfstudio / OpenSplat layout: fl_x, fl_y, cx, cy, w, h,
# camera_model OPENCV, frames[].transform_matrix = camera-to-world, OpenGL camera axes, in GAME axes: x, y up, z,
# the same space as the GLB and the splat), <out>/set.receipt.json (timings, parameters, licence).
#
# Usage (repo root; $BLENDER = Blender 5.2.2):
#   "$BLENDER" --background --factory-startup --python tools/blender/splat_set.py -- --out <scratch>/train
import json
import math
import os
import random
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bllib  # noqa: E402
import backdrop  # noqa: E402

P = bllib.args({'out': '', 'n': 150, 'w': 768, 'h': 432, 'spp': 32, 'fov_v': 50.0, 'lamp': 1.0, 'sky': 1.0,
                'bound': 150.0, 'eye_lo': 1.5, 'eye_hi': 20.0, 'pitch_lo': -3.0, 'pitch_hi': 12.0, 'start': 0})
if not P['out'] or os.path.abspath(P['out']).startswith(bllib.ROOT + os.sep):
    raise SystemExit('--out must be a scratch directory outside the repo (the training renders never land)')
bllib.check_blender()
clock = bllib.Clock()
B = clock.lap('build', backdrop.build)
sc = B.sc
G2B = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)           # game (x, y, z) -> Blender (x, -z, y)

# the Lot's stand-in floor: in the light, never in the camera
lg = bpy.data.meshes.new('LookGround')
q = 165.0
lg.from_pydata([tuple(backdrop.g2b(-q, 0, -q)), tuple(backdrop.g2b(q, 0, -q)), tuple(backdrop.g2b(q, 0, q)),
                tuple(backdrop.g2b(-q, 0, q))], [], [(0, 3, 2, 1)])
lg.materials.append(B.steel)
lgo = bpy.data.objects.new('LookGround', lg)
lgo.visible_camera = False
sc.collection.objects.link(lgo)
for (x, y, z), kind, pw in B.lamps:
    ld = bpy.data.lights.new('Sodium', 'SPOT' if kind == 'FLOOD' else 'POINT')
    ld.energy = pw * P['lamp']
    ld.shadow_soft_size = 0.5
    ld.use_temperature = True
    ld.temperature = backdrop.SODIUM_K
    ob = bpy.data.objects.new('Sodium', ld)
    ob.location = backdrop.g2b(x, y, z)
    if kind == 'FLOOD':
        ld.spot_size = math.radians(100)
        ob.rotation_euler = (backdrop.g2b(x * 0.9, 0.0, z * 0.9) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(ob)
bllib.sky_world(sc, os.path.join(bllib.ROOT, backdrop.SKY), strength=P['sky'])
cy = bllib.cycles(sc, P['spp'], adaptive_threshold=0.01)
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 2, 2
sc.render.resolution_x, sc.render.resolution_y = P['w'], P['h']
sc.render.use_persistent_data = True
bllib.view(sc, 'Standard')
cd = bpy.data.cameras.new('View')
cd.sensor_fit = 'VERTICAL'
cd.angle = math.radians(P['fov_v'])
cd.clip_end = 5000.0
cam = bpy.data.objects.new('View', cd)
sc.collection.objects.link(cam)
sc.camera = cam
fy = (P['h'] / 2) / math.tan(math.radians(P['fov_v']) / 2)

rnd = random.Random(bllib.SEED)
views = []
for i in range(P['n']):
    bearing = (i + rnd.uniform(-0.4, 0.4)) * 360.0 / P['n']
    eye = (rnd.uniform(-P['bound'], P['bound']), rnd.uniform(P['eye_lo'], P['eye_hi']), rnd.uniform(-P['bound'], P['bound']))
    views.append((eye, bearing % 360.0, rnd.uniform(P['pitch_lo'], P['pitch_hi'])))
out = os.path.abspath(P['out'])
os.makedirs(os.path.join(out, 'images'), exist_ok=True)
os.makedirs(os.path.join(out, 'depth'), exist_ok=True)


def aim(eye, bearing, pitch):
    b, p = math.radians(bearing), math.radians(pitch)
    fwd = (math.sin(b) * math.cos(p), math.sin(p), -math.cos(b) * math.cos(p))
    cam.location = backdrop.g2b(*eye)
    cam.rotation_euler = backdrop.g2b(*fwd).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    m = np.array(cam.matrix_world)
    c2w = np.eye(4)
    c2w[:3, :3] = G2B.T @ m[:3, :3]                                  # camera axes (OpenGL) in game axes
    c2w[:3, 3] = G2B.T @ m[:3, 3]
    return c2w


frames = []
s = sc.render.image_settings
for i, (eye, bearing, pitch) in enumerate(views):          # beauty passes (persistent data: one scene sync)
    c2w = aim(eye, bearing, pitch)
    name = f'frame_{i:04d}'
    frames.append({'file_path': f'images/{name}.png', 'depth_path': f'depth/{name}.npy', 'transform_matrix': c2w.tolist(),
                   'eye_game': [round(v, 3) for v in eye], 'bearing_deg': round(bearing, 3), 'pitch_deg': round(pitch, 3),
                   'held_out': i % 10 == 9})
    if i < P['start'] or os.path.exists(os.path.join(out, 'images', name + '.png')):
        continue
    s.file_format, s.color_mode, s.color_depth, s.compression = 'PNG', 'RGB', '8', 90
    sc.render.filepath = os.path.join(out, 'images', name + '.png')
    clock.lap(f'r{i}', lambda: bpy.ops.render.render(write_still=True))
    print(f'VIEW {i} {clock.laps[f"r{i}"]}', flush=True)

dm = bpy.data.materials.new('Depth')                       # depth passes: ray length as emission, the sky 0
nt = dm.node_tree
nt.nodes.clear()
lp = nt.nodes.new('ShaderNodeLightPath')
em = nt.nodes.new('ShaderNodeEmission')
nt.links.new(lp.outputs['Ray Length'], em.inputs['Strength'])
nt.links.new(em.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
sc.view_layers[0].material_override = dm
sc.world = bpy.data.worlds.new('Void')
sc.world.node_tree.nodes.clear()
lgo.hide_render = True
cy.samples, cy.use_denoising = 1, False
for i, f in enumerate(frames):
    dpath = os.path.join(out, f['depth_path'])
    if os.path.exists(dpath):
        continue
    aim(*views[i])
    img = bllib.render_exr(sc, os.path.join(out, 'depth', '_tmp.exr'), clock, lap='depth')
    a = np.empty(P['w'] * P['h'] * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    os.remove(os.path.join(out, 'depth', '_tmp.exr'))
    np.save(dpath, a.reshape(P['h'], P['w'], 4)[::-1, :, 0].astype(np.float16))

tj = {'camera_model': 'OPENCV', 'w': P['w'], 'h': P['h'], 'fl_x': fy, 'fl_y': fy, 'cx': P['w'] / 2, 'cy': P['h'] / 2,
      'k1': 0.0, 'k2': 0.0, 'p1': 0.0, 'p2': 0.0, 'space': 'game axes: x, y up, z (metres); OpenGL camera axes (looks -Z, up +Y)',
      'frames': frames}
with open(os.path.join(out, 'transforms.json'), 'w') as f:
    json.dump(tj, f, indent=1)
rec = {'kind': 'TRAINING SET (scratch only, never landed)', 'params': P, 'views': len(frames),
       'held_out': [f['file_path'] for f in frames if f['held_out']], 'transforms_sha256': bllib.sha256(os.path.join(out, 'transforms.json')),
       'backdrop_script_sha256': bllib.sha256(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backdrop.py')),
       'script_sha256': bllib.sha256(os.path.abspath(__file__)), 'sky_sha256': bllib.sha256(os.path.join(bllib.ROOT, backdrop.SKY)),
       'render': {'engine': 'Cycles CPU', 'spp': P['spp'], 'seed': bllib.SEED, 'view_transform': 'Standard', 'haze': 'none',
                  'lot': 'camera-invisible (LookGround stand-in)'},
       'timing': {'load_at_start': clock.load_at_start, 'total': clock.total(),
                  'beauty_wall_s': round(sum(v['wall_s'] for k, v in clock.laps.items() if k.startswith('r')), 1)},
       'blender': bpy.app.version_string, 'licence': bllib.LICENCE}
with open(os.path.join(out, 'set.receipt.json'), 'w') as f:
    json.dump(rec, f, indent=1)
print('SETDONE', json.dumps({k: rec[k] for k in ('views', 'timing')}))

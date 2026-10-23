# backdrop.py (W17 AAA pass 4 BACKDROP, lane BL-DCC): the skyline beyond the Lot's fence, built in Blender.
#
# build() makes the backdrop scene; backdrop_glb.py imports this module and exports assets/backdrop/lot_backdrop.glb;
# run as a script it renders look views from inside the Lot, lit by the sky SOURCE and sodium lamps.
#
# What it is (game axes: x, y up, z; the Lot centre is the origin; everything seeded, read from the shared data):
# - the six Lot kit masters (assets/masters/*.glb: containers, bag walls, pipes, footings, flood masts, flood lamps), LOD1 in
#   the front rows and LOD2 behind (they sit 216 m and more away), placed as a port yard in bands 222-300 m out on the
#   south, east and north sides. Never inside max(|x|, |z|) < 216 m (AAA_PLAN ruling 4).
# - new crane and gantry silhouettes (ship-to-shore cranes, tower cranes, rubber-tyred gantries) from beams, every
#   vertex 400-900 m from the centre.
# - sodium lamp cards (small emissive icospheres) on the flood towers, the cranes and the yard.
# - a dark wet apron from 165 m out to 1.5 km at y = 0 (the Lot's terrain edge is at 0), so nothing floats.
# - kept clear of what the game already draws out there: every prim of the_lot.json beyond 165 m (the far rooftops, the
#   trees, the neighbours' house, the tower crane) and the West Yard side of the west fence.
# Draws: one material per family = the six kit materials, BD_DarkSteel (cranes, gantries, apron), BD_SodiumLamp = 8.
#
# Usage (repo root; $BLENDER = Blender 5.2.2):
#   "$BLENDER" --background --factory-startup --python tools/blender/backdrop.py -- --out <scratch>/look [--w 960 --h 540 --spp 32]
# writes <out>_<view>.png (AgX), <out>_hero_fog.png (the hero view with look.gd's exponential fog applied from a depth
# render: density 0.0045, colour = the sky receipt's horizon) and <out>.json (timings, scene facts).
import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bllib  # noqa: E402

KITS = ['Kit_Lot_Container20_01', 'Kit_Lot_BagWall_01', 'Kit_Lot_Pipe_01', 'Kit_Lot_Footing_01', 'Kit_Lot_FloodMast_01',
        'Kit_Lot_FloodLamp_01']
NEAR = 216.0                 # nothing nearer (max(|x|, |z|), AAA_PLAN ruling 4)
FAR_LO, FAR_HI = 400.0, 900.0  # cranes and gantries (distance from the centre, every vertex)
APRON = (165.0, 1500.0)
SODIUM_K = 2700.0
SKY = os.path.join('assets', 'sky', 'lot_night_sky.exr')


def g2b(x, y, z):
    return Vector((x, -z, y))


class Builder:
    def __init__(self, seed=bllib.SEED):
        self.rnd = random.Random(seed)
        self.lot = bllib.lot()
        self.sc = bpy.context.scene
        self.coll = bpy.data.collections.new('Backdrop')
        self.sc.collection.children.link(self.coll)
        self.lamps = []          # (game xyz, kind, power) for the look render's lights
        self.placed = []         # (x, z, r) footprints of what this builder placed
        self.facts = {'kit_instances': {}}
        pf = self.lot['primFields']
        self.obstacles = []
        for p in self.lot['prims']:
            c = dict(zip(pf, p))
            if max(abs(c['x']), abs(c['z'])) > 165:
                r = (max(c['a'], c['c']) / 2) if c['shape'] == 'box' else c['a']
                self.obstacles.append((c['x'], c['z'], r))
        self.west = [f['x0'] for f in self.lot['fences'] if f['x0'] == f['x1'] and f['face'] == -1]
        self.kit = {}
        for k in KITS:
            self.kit[k] = self.load_kit(k)
        self.steel = self.material_steel()
        self.lens = self.material_lamp()

    # ---------------------------------------------------------------- materials and kits
    def load_kit(self, name):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(bllib.ROOT, 'assets', 'masters', name + '.glb'))
        new = [o for o in bpy.data.objects if o not in before]
        out = {}
        for lod in (1, 2):
            o = next(o for o in new if o.name.endswith(f'_LOD{lod}'))
            me = o.data
            me.name = f'{name}_LOD{lod}'
            out[lod] = (me, o.matrix_world.copy())
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        me, base = out[1]
        co = [base @ v.co for v in me.vertices]                    # Blender axes after the import's own matrix
        ext = lambda k: max(c[k] for c in co) - min(c[k] for c in co)
        out['size'] = (ext(0), ext(2), ext(1))                      # game x, y (up), z extents
        return out

    def material_steel(self):
        m = bpy.data.materials.new('BD_DarkSteel')
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (0.032, 0.030, 0.027, 1)
        b.inputs['Metallic'].default_value = 0.3
        b.inputs['Roughness'].default_value = 0.42
        return m

    def material_lamp(self):
        m = bpy.data.materials.new('BD_SodiumLamp')
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1)
        b.inputs['Roughness'].default_value = 0.5
        b.inputs['Emission Color'].default_value = (1.0, 0.55, 0.22, 1)   # sodium, a flat emissive (glTF emissive)
        b.inputs['Emission Strength'].default_value = 30.0
        self.facts['lamp_colour'] = [1.0, 0.55, 0.22]
        return m

    # ---------------------------------------------------------------- placement
    def free(self, x, z, r, clear=6.0):
        if max(abs(x), abs(z)) - r < NEAR:
            return False
        if self.west and x - r < self.west[0] + 8 and abs(z) < 230:          # the West Yard side
            return False
        for ox, oz, orr in self.obstacles:
            if math.hypot(x - ox, z - oz) < r + orr + clear:
                return False
        for ox, oz, orr in self.placed:
            if math.hypot(x - ox, z - oz) < r + orr + 0.5:
                return False
        return True

    def put(self, kit, lod, x, y, z, yaw):
        me, base = self.kit[kit][lod]
        ob = bpy.data.objects.new(me.name, me)
        ob.matrix_world = Matrix.Translation(g2b(x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ base
        self.coll.objects.link(ob)
        self.facts['kit_instances'][kit] = self.facts['kit_instances'].get(kit, 0) + 1
        return ob

    def lamp_card(self, x, y, z, r=0.6, power=2500.0, kind='POINT'):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=g2b(x, y, z))
        o = bpy.context.active_object
        o.name = 'BD_Lamp'
        o.data.materials.append(self.lens)
        for c in list(o.users_collection):
            c.objects.unlink(o)
        self.coll.objects.link(o)
        self.lamps.append(((x, y, z), kind, power))
        return o

    def beam(self, a, b, w, h=None, lattice=False):
        """A steel member between two game points (w x h section); lattice = a wireframe truss."""
        p0, p1 = g2b(*a), g2b(*b)
        d = p1 - p0
        L = d.length
        h = h or w
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(p0 + p1) / 2)
        o = bpy.context.active_object
        o.scale = (w, h, L)
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        if lattice:
            import bmesh
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if (e.verts[0].co - e.verts[1].co).length > 0.9 * L],
                                      cuts=max(2, int(L / max(w, 3.0))), use_grid_fill=False)
            bm.to_mesh(o.data)
            bm.free()
            mod = o.modifiers.new('lat', 'WIREFRAME')
            mod.thickness = 0.4
            mod.use_replace = True
        o.data.materials.append(self.steel)
        o.name = 'BD_Steel'
        for c in list(o.users_collection):
            c.objects.unlink(o)
        self.coll.objects.link(o)
        return o

    # ---------------------------------------------------------------- the yard (kit masters, 216-300 m)
    def yard(self):
        r = self.rnd
        cw, ch, cl = self.kit['Kit_Lot_Container20_01']['size']   # x width, y height, z length (long axis z)
        bands = []
        for k, off in enumerate((228.0, 262.0, 296.0)):
            lod = 1 if k == 0 else 2
            for side in ('S', 'E', 'N'):
                t = -330.0
                while t <= 330.0:
                    if side == 'S':
                        bands.append((t, off, math.pi / 2, lod, k))
                    elif side == 'E':
                        bands.append((off, t, 0.0, lod, k))
                    else:
                        bands.append((t, -off, math.pi / 2, lod, k))
                    t += cl + 1.2
        n = 0
        for x, z, yaw, lod, k in bands:
            if r.random() < 0.22:
                continue
            hgt = r.choice((1, 1, 2, 2, 3, 4) if k else (1, 1, 2, 2, 3))
            x2, z2 = x + r.uniform(-0.6, 0.6), z + r.uniform(-0.8, 0.8)
            if not self.free(x2, z2, cl / 2):
                continue
            self.placed.append((x2, z2, cl / 2))
            for s in range(hgt):
                self.put('Kit_Lot_Container20_01', lod, x2, s * ch, z2, yaw + r.choice((0.0, math.pi)) + r.uniform(-0.02, 0.02))
                n += 1
        self.facts['containers'] = n
        # bag walls along the front of the south and east bands, pipe runs on footings
        bw = self.kit['Kit_Lot_BagWall_01']['size'][0]
        for side, run in (('S', range(-120, 160, 6)), ('E', range(-160, 160, 6))):
            for t in run:
                x, z, yaw = (t, 219.0, 0.0) if side == 'S' else (219.0, t, math.pi / 2)
                if self.free(x, z, bw / 2, clear=3.0):
                    self.put('Kit_Lot_BagWall_01', 2, x, 0.0, z, yaw)      # LOD2: 1.1 m tall, 219 m away
        pl = self.kit['Kit_Lot_Pipe_01']['size'][2]
        for row, (x0, z0, dx, dz, yaw) in enumerate(((-60.0, 244.0, pl, 0.0, math.pi / 2), (244.0, -90.0, 0.0, pl, 0.0),
                                                      (40.0, 222.0, pl, 0.0, math.pi / 2), (222.0, 40.0, 0.0, pl, 0.0))):
            for i in range(14):
                x, z = x0 + dx * i, z0 + dz * i
                if self.free(x, z, pl / 2, clear=3.0):
                    self.placed.append((x, z, pl / 2))
                    self.put('Kit_Lot_Footing_01', 1, x, 0.0, z, yaw)
                    self.put('Kit_Lot_Pipe_01', 1, x, self.kit['Kit_Lot_Footing_01']['size'][1], z, yaw)
        # flood towers: mast + three lamp heads, lamp cards and a downlight each
        mh = self.kit['Kit_Lot_FloodMast_01']['size'][1]
        towers = []                                         # up to 12, >= 12 deg apart, wherever the scenery leaves room
        for b in list(range(126, 236, 6)) + list(range(48, 126, 6)) + list(range(330, 360, 6)) + list(range(0, 42, 6)):
            if len(towers) >= 12 or any(abs((b - t + 180) % 360 - 180) < 12 for t in towers):
                continue
            for d in (244.0, 266.0, 310.0, 340.0):
                br = math.radians(b)
                x, z = math.sin(br) * d, -math.cos(br) * d
                if self.free(x, z, 3.0, clear=3.0):
                    towers.append(b)
                    break
            else:
                continue
            self.placed.append((x, z, 3.0))
            self.put('Kit_Lot_FloodMast_01', 1, x, 0.0, z, r.uniform(0, 6.28))
            face = math.atan2(-x, -z)                       # the heads face the Lot
            for j in range(3):
                yaw = face + (j - 1) * 0.5
                lx, lz = x + math.sin(yaw) * 1.4, z + math.cos(yaw) * 1.4
                self.put('Kit_Lot_FloodLamp_01', 1, lx, mh - 0.4, lz, yaw)
                self.lamp_card(lx + math.sin(yaw) * 0.6, mh - 0.2, lz + math.cos(yaw) * 0.6, 0.55, 9000.0, 'FLOOD')
        # low yard lamps on the container fronts
        for b in range(0, 360, 14):
            br = math.radians(b + 3)
            d = 226.0
            x, z = math.sin(br) * d, -math.cos(br) * d
            if self.free(x, z, 0.5, clear=2.0):
                self.lamp_card(x, 8.5, z, 0.35, 1800.0)

    # ---------------------------------------------------------------- cranes and gantries (400-900 m)
    def sts_crane(self, cx, cz, yaw, s):
        """Ship-to-shore crane: four legs, portal beams, a boom across the quay, an A-frame and stays."""
        c, sn = math.cos(yaw), math.sin(yaw)
        w = lambda lx, y, lz: (cx + lx * c + lz * sn, y, cz - lx * sn + lz * c)
        for lx, lz in ((-14, -10), (14, -10), (-14, 10), (14, 10)):
            self.beam(w(lx * s, 0, lz * s), w(lx * s, 50 * s, lz * s), 2.2 * s)
        for lz in (-10, 10):
            self.beam(w(-14 * s, 50 * s, lz * s), w(14 * s, 50 * s, lz * s), 2.2 * s, 3.0 * s)
        for lx in (-14, 14):
            self.beam(w(lx * s, 18 * s, -10 * s), w(lx * s, 18 * s, 10 * s), 1.4 * s)
        self.beam(w(0, 54 * s, -48 * s), w(0, 54 * s, 70 * s), 4.6 * s, 5.0 * s, lattice=True)
        apex = w(0, 84 * s, -4 * s)
        for lx in (-12, 12):
            self.beam(w(lx * s, 50 * s, -10 * s), apex, 1.4 * s)
            self.beam(w(lx * s, 50 * s, 10 * s), apex, 1.4 * s)
        for tz in (66, 40, -44):
            self.beam(apex, w(0, 56 * s, tz * s), 0.5 * s)
        for bz in (-30, 10, 50):
            p = w(0, 51 * s, bz * s)
            self.lamp_card(p[0], p[1], p[2], 0.7 * s, 4000.0 * s)

    def tower_crane(self, cx, cz, hgt, jib, yaw):
        dx, dz = math.sin(yaw), -math.cos(yaw)
        self.put('Kit_Lot_Footing_01', 1, cx, 0.0, cz, yaw)
        self.beam((cx, 0, cz), (cx, hgt, cz), 4.0, lattice=True)
        self.beam((cx - dx * 30, hgt + 2, cz - dz * 30), (cx + dx * jib, hgt + 2, cz + dz * jib), 2.6, 3.2, lattice=True)
        self.beam((cx, hgt, cz), (cx, hgt + 16, cz), 2.0)
        self.beam((cx, hgt + 16, cz), (cx + dx * jib * 0.55, hgt + 4, cz + dz * jib * 0.55), 0.35)
        self.beam((cx, hgt + 16, cz), (cx - dx * 28, hgt + 4, cz - dz * 28), 0.35)
        self.lamp_card(cx, hgt + 17.5, cz, 0.9, 1500.0)

    def rtg(self, cx, cz, yaw):
        """Rubber-tyred gantry: two portal frames 26 m tall spanning 24 m, joined along the rows."""
        c, sn = math.cos(yaw), math.sin(yaw)
        w = lambda lx, y, lz: (cx + lx * c + lz * sn, y, cz - lx * sn + lz * c)
        for lz in (-7, 7):
            for lx in (-12, 12):
                self.beam(w(lx, 0, lz), w(lx, 26, lz), 1.2)
            self.beam(w(-12, 26, lz), w(12, 26, lz), 1.6, 2.2)
        for lx in (-12, 12):
            self.beam(w(lx, 26, -7), w(lx, 26, 7), 1.2)
            self.beam(w(lx, 4, -7), w(lx, 4, 7), 1.0)
        p = w(0, 25, 0)
        self.lamp_card(p[0], p[1], p[2], 0.5, 1500.0)

    def cranes(self):
        r = self.rnd
        out = []
        for b, d, s in ((172, 560, 2.0), (196, 620, 2.1), (214, 700, 1.9), (150, 640, 2.0), (120, 760, 1.8), (238, 780, 1.8)):
            br = math.radians(b)
            self.sts_crane(math.sin(br) * d, -math.cos(br) * d, br + math.pi / 2, s)
            out.append(('sts', b, d))
        for b, d, h, j in ((185, 440, 120, 90), (100, 470, 140, 100), (300, 520, 130, 95), (25, 600, 150, 110), (250, 470, 125, 90)):
            br = math.radians(b)
            self.tower_crane(math.sin(br) * d, -math.cos(br) * d, h, j, br + math.pi / 2 + r.uniform(-0.25, 0.25))  # jib ~tangential
            out.append(('tower', b, d))
        for b in (160, 176, 205, 222, 75, 88, 335):
            d = r.uniform(420, 520)
            br = math.radians(b)
            self.rtg(math.sin(br) * d, -math.cos(br) * d, br)
            out.append(('rtg', b, round(d)))
        self.facts['cranes'] = out

    def apron(self):
        a, b = APRON
        verts = []
        for rr in (a, b):
            verts += [g2b(-rr, 0.0, -rr), g2b(rr, 0.0, -rr), g2b(rr, 0.0, rr), g2b(-rr, 0.0, rr)]
        faces = [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        me = bpy.data.meshes.new('BD_Apron')
        me.from_pydata([tuple(v) for v in verts], [], faces)
        me.materials.append(self.steel)
        me.update()
        o = bpy.data.objects.new('BD_Apron', me)
        self.coll.objects.link(o)
        # the faces must point up
        for p in me.polygons:
            if p.normal.z < 0:
                p.flip()
        me.update()
        return o

    def smooth_steel(self):
        """Apply the lattice wireframes and shade the steel smooth: at 400-900 m a beam's shading model is invisible, and
        smooth corners share vertices (the GLB is a third smaller)."""
        steel = [o for o in self.coll.objects if o.name.startswith('BD_Steel')]
        bpy.ops.object.select_all(action='DESELECT')
        for o in steel:
            o.select_set(True)
        bpy.context.view_layer.objects.active = steel[0]
        bpy.ops.object.convert(target='MESH')
        for o in steel:
            o.data.polygons.foreach_set('use_smooth', [True] * len(o.data.polygons))
            o.data.update()

    def build(self):
        self.yard()
        self.cranes()
        self.smooth_steel()
        self.apron()
        self.facts['lamp_cards'] = len(self.lamps)
        return self


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return Builder().build()


# ------------------------------------------------------------------------------------------------ look views
VIEWS = {   # name: (eye game xyz, bearing deg (0 = -Z, 90 = +X), pitch deg)
    'hero': ((0.0, 1.38, -10.0), 188.0, 8.0),
    'south_fence': ((0.0, 1.6, 140.0), 188.0, 6.0),
    'east': ((120.0, 1.6, 20.0), 90.0, 6.0),
    'north': ((10.0, 1.6, -120.0), 0.0, 6.0),
}


def look(P):
    clock = bllib.Clock()
    B = clock.lap('build', build)
    sc = B.sc
    lotground = bpy.data.meshes.new('LookGround')       # the Lot's floor, for the look views only (never exported)
    q = 165.0
    lotground.from_pydata([tuple(g2b(-q, 0, -q)), tuple(g2b(q, 0, -q)), tuple(g2b(q, 0, q)), tuple(g2b(-q, 0, q))], [], [(0, 3, 2, 1)])
    lotground.materials.append(B.steel)
    sc.collection.objects.link(bpy.data.objects.new('LookGround', lotground))
    for (x, y, z), kind, pw in B.lamps:
        ld = bpy.data.lights.new('Sodium', 'SPOT' if kind == 'FLOOD' else 'POINT')
        ld.energy = pw * P['lamp']
        ld.shadow_soft_size = 0.5
        ld.use_temperature = True
        ld.temperature = SODIUM_K
        ob = bpy.data.objects.new('Sodium', ld)
        ob.location = g2b(x, y, z)
        if kind == 'FLOOD':
            ld.spot_size = math.radians(100)
            ob.rotation_euler = (g2b(x * 0.9, 0.0, z * 0.9) - ob.location).to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(ob)
    bllib.sky_world(sc, os.path.join(bllib.ROOT, SKY), strength=P['sky'])
    cy = bllib.cycles(sc, P['spp'], adaptive_threshold=0.01)
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 2, 2
    sc.render.resolution_x, sc.render.resolution_y = P['w'], P['h']
    bllib.view(sc, 'Standard')
    cd = bpy.data.cameras.new('View')
    cd.sensor_fit = 'VERTICAL'
    cd.angle = math.radians(72.0)
    cd.clip_end = 5000.0
    cam = bpy.data.objects.new('View', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    rec = json.load(open(os.path.join(bllib.ROOT, 'assets', 'sky', 'lot_night_sky.receipt.json')))
    fog_col = np.array(rec['sky']['horizon_linear'])
    out = {}
    for name, (eye, bearing, pitch) in VIEWS.items():
        b, p = math.radians(bearing), math.radians(pitch)
        fwd = (math.sin(b) * math.cos(p), math.sin(p), -math.cos(b) * math.cos(p))
        cam.location = g2b(*eye)
        cam.rotation_euler = g2b(*fwd).to_track_quat('-Z', 'Y').to_euler()   # camera looks down -Z, up = its +Y
        img = bllib.render_exr(sc, P['out'] + f'_{name}.exr', clock, lap=f'render_{name}')
        bllib.save_preview(sc, img, P['out'] + f'_{name}.png', 'AgX')
        bllib.view(sc, 'Standard')
        out[name] = {'eye': eye, 'bearing_deg': bearing, 'pitch_deg': pitch}
        if name == 'hero':
            # depth: camera-ray length as emission, the sky as 'infinitely far' (fog would not apply to it here)
            dm = bpy.data.materials.new('Depth')
            nt = dm.node_tree
            nt.nodes.clear()
            lp = nt.nodes.new('ShaderNodeLightPath')
            em = nt.nodes.new('ShaderNodeEmission')
            nt.links.new(lp.outputs['Ray Length'], em.inputs['Strength'])
            nt.links.new(em.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
            sc.view_layers[0].material_override = dm
            keep_world, keep_spp, keep_dn = sc.world, cy.samples, cy.use_denoising
            sc.world = bpy.data.worlds.new('Void')
            sc.world.node_tree.nodes.clear()
            cy.samples, cy.use_denoising = 1, False
            dimg = bllib.render_exr(sc, P['out'] + '_hero_depth.exr', clock, lap='render_depth')
            sc.view_layers[0].material_override = None
            sc.world, cy.samples, cy.use_denoising = keep_world, keep_spp, keep_dn
            w_, h_ = img.size
            c = np.empty(w_ * h_ * 4, np.float32)
            img.pixels.foreach_get(c)
            dd = np.empty(w_ * h_ * 4, np.float32)
            dimg.pixels.foreach_get(dd)
            c, dd = c.reshape(-1, 4), dd.reshape(-1, 4)[:, 0]
            geo = dd > 0
            t = np.exp(-P['fog'] * dd)
            c[geo, :3] = c[geo, :3] * t[geo, None] + fog_col * (1 - t[geo, None])
            fimg = bpy.data.images.new('hero_fog', w_, h_, alpha=False, float_buffer=True)
            fimg.colorspace_settings.name = 'Linear Rec.709'
            fimg.pixels.foreach_set(c.ravel())
            bllib.save_preview(sc, fimg, P['out'] + '_hero_fog.png', 'AgX')
            bllib.view(sc, 'Standard')
            for dist in (216, 300, 400, 600, 900):
                out.setdefault('fog_at_m', {})[dist] = round(1 - math.exp(-P['fog'] * dist), 3)
            out['fog'] = {'density': P['fog'], 'colour_linear': fog_col.tolist(), 'formula': '1 - exp(-density * distance)',
                          'sky': 'not fogged here (depth = 0 on sky texels)'}
    rep = {'views': out, 'facts': B.facts, 'timing': {'load_at_start': clock.load_at_start, **clock.laps, 'total': clock.total()},
           'params': P, 'blender': bpy.app.version_string}
    with open(P['out'] + '.json', 'w') as f:
        json.dump(rep, f, indent=1)
    print('BACKDROPLOOK', json.dumps({k: rep[k] for k in ('facts', 'timing')}))


if __name__ == '__main__':
    bllib.check_blender()
    look(bllib.args({'out': '', 'w': 960, 'h': 540, 'spp': 32, 'lamp': 1.0, 'sky': 1.0, 'fog': 0.0045}))

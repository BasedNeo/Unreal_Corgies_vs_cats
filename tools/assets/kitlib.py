# kitlib.py (W11 P-GLB1b): the shared half of the kit build scripts (build-container.py, build-bagwall.py), for Blender 5
# as a Python module (bpy 5.0.1, Python 3.11). Everything here is deterministic: seeded value noise, fixed Cycles
# seed/samples/threads, no denoiser, textures quantized once before they are saved.
#
#   Noise / sstep / mix / col        numpy painting helpers (value-noise fBm on a seeded 256^2 lattice)
#   g2b / make_mesh                  game axes (x, y up, z front) -> Blender axes, and a flat-shaded mesh with one UV map
#   build_kit(...)                   the common tail: PBR material (baseColor[+paint mask in A], ORM, normal), the LOD
#                                    objects under the root, the Cycles AO bake of LOD0 on a ground plane, the images,
#                                    the COL_ boxes (after the bake), and the glTF export
import json
import math
import os

import bpy
import numpy as np


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


def hex_srgb(h):
    """0xRRGGBB -> sRGB floats (the palette's hex values)."""
    return col(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255)


def g2b(p):
    """Game axes (x, y up, z front) -> Blender axes (x, y back, z up); the glTF exporter maps them back."""
    return (p[0], -p[2], p[1])


def make_mesh(name, polys, mat=None, smooth=False):
    """polys: list of (verts in game axes, uvs). One UV map; flat shading unless `smooth`."""
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
        poly.use_smooth = smooth
    if mat:
        me.materials.append(mat)
    me.update()
    return me


def make_indexed_mesh(name, verts, faces, uvs, mat=None, smooth=True):
    """An indexed mesh (shared vertices, smooth normals) with per-corner UVs: faces = tuples of vertex indices,
    uvs = one (u, v) per face corner in face order."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([g2b(v) for v in verts], [], faces)
    me.validate(clean_customdata=False)
    layer = me.uv_layers.new(name='UVMap')
    layer.data.foreach_set('uv', [float(c) for u in uvs for c in u])
    for poly in me.polygons:
        poly.use_smooth = smooth
    if mat:
        me.materials.append(mat)
    me.update()
    return me


def box_col_mesh(name, size):
    """An axis-aligned box mesh (8 corners, 6 outward quads) of `size` (game axes), centred on its origin."""
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
    me = bpy.data.meshes.new(name)
    me.from_pydata([g2b(v) for v in vs], [], quads)
    me.update()
    return me


def build_kit(name, lod_meshes_fn, colliders, alb, rough, metal, nrm, out, atlas, samples=48, ao_distance=4.0,
              ao_floor=0.18, ao_into_albedo=0.28, paint_mask=None, ao_fix=None, pad=4):
    """The common tail of a kit build. lod_meshes_fn(mat) -> [LOD0, LOD1, LOD2] bpy meshes (with the material).
    colliders: [(sim_type, centre, size)] in game axes. alb (sRGB), rough, metal, nrm (tangent space, -1..1): atlas
    arrays. paint_mask (0..1, or None): stored in the baseColor alpha (1 = the paint the game tints per instance), as
    1 + 254 * mask so no texel is fully transparent (a lossy WebP encoder may rewrite the colour under alpha 0).
    ao_fix(ao) may edit the baked AO before it is used. Returns a dict of build facts."""
    os.makedirs(out, exist_ok=True)
    sc = bpy.context.scene

    def new_image(iname, rgb, alpha=None, non_color=False):
        img = bpy.data.images.new(iname, atlas, atlas, alpha=alpha is not None, float_buffer=False)
        if non_color:
            img.colorspace_settings.name = 'Non-Color'
        if alpha is not None:
            img.alpha_mode = 'STRAIGHT'
        px = np.ones((atlas, atlas, 4), np.float32)
        px[..., :3] = rgb
        if alpha is not None:
            px[..., 3] = (1 + np.round(254 * np.clip(alpha, 0, 1))) / 255
        px = np.round(px * 255) / 255                  # quantize once so the saved PNG equals the painted values
        img.pixels.foreach_set(px.ravel())
        return img

    mat = bpy.data.materials.new(f'M_{name}')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], outn.inputs['Surface'])
    tex_bc = nt.nodes.new('ShaderNodeTexImage'); tex_bc.name = 'baseColor'
    tex_orm = nt.nodes.new('ShaderNodeTexImage'); tex_orm.name = 'orm'
    tex_n = nt.nodes.new('ShaderNodeTexImage'); tex_n.name = 'normal'
    tex_ao = nt.nodes.new('ShaderNodeTexImage'); tex_ao.name = 'ao_bake'

    root = bpy.data.objects.new(name, None)
    sc.collection.objects.link(root)
    lod_objs, tris = [], []
    for lod, me in enumerate(lod_meshes_fn(mat)):
        ob = bpy.data.objects.new(f'{name}_LOD{lod}', me)
        sc.collection.objects.link(ob)
        ob.parent = root
        lod_objs.append(ob)
        tris.append(sum(len(p.vertices) - 2 for p in me.polygons))
        print(f'LOD{lod}: {tris[-1]} triangles')

    # ---- AO bake (Cycles, LOD0 on a ground plane), into the atlas
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.seed = 7
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    world = bpy.data.worlds.new('bake')
    sc.world = world
    world.light_settings.distance = ao_distance
    gme = bpy.data.meshes.new('ground')
    gme.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('ground', gme)
    sc.collection.objects.link(ground)
    ao_img = bpy.data.images.new('ao_bake', atlas, atlas, alpha=False, float_buffer=True)
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
    bpy.ops.object.bake(type='AO', margin=pad, margin_type='EXTEND', use_clear=True)
    for ob in lod_objs[1:]:
        ob.hide_render = False
    ao = np.array(ao_img.pixels[:], np.float32).reshape(atlas, atlas, 4)[..., 0].astype(float)
    if ao_fix:
        ao = ao_fix(ao)
    ao = np.clip(ao_floor + (1 - ao_floor) * ao, 0, 1)
    bpy.data.objects.remove(ground)
    nt.nodes.remove(tex_ao)
    bpy.data.images.remove(ao_img)
    print(f'AO bake: mean {ao.mean():.3f}, min {ao.min():.3f}')

    # cavity: a light AO multiply into the base colour too (the toon path ignores aoMap)
    alb_ao = alb * ((1 - ao_into_albedo) + ao_into_albedo * ao)[..., None]
    img_bc = new_image(f'{name}_baseColor', np.clip(alb_ao, 0, 1), alpha=paint_mask)
    img_orm = new_image(f'{name}_orm', np.stack([ao, np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)], -1), non_color=True)
    img_n = new_image(f'{name}_normal', nrm * 0.5 + 0.5, non_color=True)
    for img in (img_bc, img_orm, img_n):
        img.filepath_raw = os.path.join(out, img.name + '.png')
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

    # ---- COL_ proxies (after the AO bake: they would occlude it): node at the box centre, mesh = +-half extents
    for i, (typ, cc, size) in enumerate(colliders):
        ob = bpy.data.objects.new(f'COL_{name}_{i}', box_col_mesh(f'COL_{name}_{i}', size))
        ob.location = g2b(cc)
        ob['collider'] = 'box'
        ob['sim_type'] = typ
        sc.collection.objects.link(ob)
        ob.parent = root

    # ---- export
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [root] + list(root.children):
        ob.select_set(True)
    glb = os.path.join(out, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
        export_image_format='AUTO', export_extras=True, export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_morph=False)
    return dict(glb=glb, bytes=os.path.getsize(glb), tris=tris, ao_mean=float(ao.mean()), blender=bpy.app.version_string)


def report(info, root):
    info = dict(info)
    info['glb'] = os.path.relpath(info['glb'], root)
    print('BUILD', json.dumps(info))

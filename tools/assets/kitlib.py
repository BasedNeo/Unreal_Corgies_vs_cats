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

    # ---- COL_ proxies (after the AO bake: they would occlude it): node at the box centre, mesh = +-half extents.
    # P-GLB3: an optional 4th element is a 3x3 rotation (game axes; an oriented box, extras.collider = 'obb', for sim
    # colliders that are turned about their own centre like the pipe facets) and a 5th a dict of extra extras.
    for i, cdef in enumerate(colliders):
        typ, cc, size = cdef[:3]
        ob = bpy.data.objects.new(f'COL_{name}_{i}', box_col_mesh(f'COL_{name}_{i}', size))
        ob.location = g2b(cc)
        ob['collider'] = 'box'
        if len(cdef) > 3 and cdef[3] is not None:
            ob.rotation_mode = 'QUATERNION'
            ob.rotation_quaternion = rot_g2b(cdef[3])
            ob['collider'] = 'obb'
        ob['sim_type'] = typ
        for k, v in (cdef[4].items() if len(cdef) > 4 else ()):
            ob[k] = v
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


# ================================================================================================ P-GLB3 (batch 1)
# Shared by build-pipe.py, build-footing.py and build-floodtower.py: game-axes rotations, the palette, a generic face
# atlas (faces are rectangles in metres, shelf-packed at the largest texel density that fits), per-face painting into
# baseColor / roughness / metalness / height (-> tangent-space normal) / paint mask, and a polygon mesh builder with
# smooth groups (vertices are welded only inside one group, so a hard edge is simply two groups).
def rot_g2b(R):
    """A 3x3 rotation in game axes -> the Blender quaternion (B R B^T, B = g2b as a matrix)."""
    from mathutils import Matrix
    B = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
    Rb = B @ np.asarray(R, float) @ B.T
    return Matrix([list(map(float, r)) for r in Rb]).to_quaternion()


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], float)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def palette(root, key):
    """A palette colour (sRGB floats) by name: src/client/world/world-palette.ts, then style-tokens.js's PALETTE."""
    import re
    for f in (('src', 'client', 'world', 'world-palette.ts'), ('src', 'client', 'style', 'style-tokens.js')):
        m = re.search(r'\b' + key + r':\s*0x([0-9a-fA-F]{6})', open(os.path.join(root, *f), encoding='utf8').read())
        if m:
            return hex_srgb(int(m.group(1), 16))
    raise KeyError(key)


def shelf_pack(items, atlas, pad, reserve=0):
    """items: [(id, w_px, h_px)] -> {id: (x, y, w, h, rot)} (x, y = the rect inside its gutter) or None if it does not
    fit. Tall rects turn 90 degrees; shelves fill from the bottom; `reserve` px stay free at the top."""
    its = []
    for fid, w, h in items:
        rot = h > w
        its.append((fid, h, w, rot) if rot else (fid, w, h, rot))
    its.sort(key=lambda it: (-it[2], -it[1], it[0]))
    x = y = shelf = 0
    rects = {}
    for fid, w, h, rot in its:
        W2, H2 = w + 2 * pad, h + 2 * pad
        if W2 > atlas:
            return None
        if x + W2 > atlas:
            x, y, shelf = 0, y + shelf, 0
        if y + H2 > atlas - reserve:
            return None
        rects[fid] = (x + pad, y + pad, w, h, rot)
        x += W2
        shelf = max(shelf, H2)
    return rects


def solve_atlas(faces, atlas, pad, density, reserve=0):
    """faces: [dict(id, kind, w, h)] in metres. The largest px/m (to 0.01) at which every face, at density[kind] x that,
    fits the atlas. Returns (px_per_m, rects)."""
    def items(scale):
        return [(f['id'], max(4, int(math.ceil(f['w'] * density[f['kind']] * scale))),
                 max(4, int(math.ceil(f['h'] * density[f['kind']] * scale)))) for f in faces]
    lo, hi = 1.0, 2048.0
    best = None
    while hi - lo > 0.01:
        mid = (lo + hi) / 2
        r = shelf_pack(items(mid), atlas, pad, reserve)
        if r is None:
            hi = mid
        else:
            lo, best = mid, r
    return round(lo, 2), best


def face_uv(rect, face, s, t, atlas):
    """Atlas UV of face-local metres (s along its width w, t along its height h)."""
    x, y, w, h, rot = rect
    if rot:
        return ((x + t / face['h'] * w) / atlas, (y + (face['w'] - s) / face['w'] * h) / atlas)
    return ((x + s / face['w'] * w) / atlas, (y + t / face['h'] * h) / atlas)


def paint_faces(faces, rects, paint, atlas, pad, base_rgb, base_rough=0.8):
    """Paints every face into its rect (and its gutter, continuing the face's metres). paint(face, S, T) -> (rgb, rough,
    metal, height_m, mask) on metre grids S (0..w), T (0..h); the face's own s0 / t0 offsets are added by the painter
    when it wants continuous noise across faces. Returns alb, rough, metal, nrm (tangent space), mask."""
    alb = np.zeros((atlas, atlas, 3)); alb[:] = base_rgb
    rough = np.full((atlas, atlas), base_rough)
    metal = np.zeros((atlas, atlas))
    mask = np.zeros((atlas, atlas))
    nrm = np.zeros((atlas, atlas, 3)); nrm[..., 2] = 1
    for f in faces:
        x, y, w, h, rot = rects[f['id']]
        Ui, Vj = np.meshgrid(np.arange(-pad, w + pad) + 0.5, np.arange(-pad, h + pad) + 0.5)
        if rot:
            ku, kv = w / f['h'], h / f['w']
            T, S = Ui / ku, f['w'] - Vj / kv
        else:
            ku, kv = w / f['w'], h / f['h']
            S, T = Ui / ku, Vj / kv
        c, r, mt, hgt, mk = paint(f, S, T)
        hgt = np.broadcast_to(hgt, S.shape)
        dhu = np.gradient(hgt, axis=1) * ku
        dhv = np.gradient(hgt, axis=0) * kv
        n = np.stack([-dhu, -dhv, np.ones_like(hgt)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        ys, xs = slice(y - pad, y + h + pad), slice(x - pad, x + w + pad)
        alb[ys, xs] = np.clip(c, 0, 1)
        rough[ys, xs] = np.clip(np.broadcast_to(r, S.shape), 0.04, 1)
        metal[ys, xs] = np.clip(np.broadcast_to(mt, S.shape), 0, 1)
        mask[ys, xs] = np.clip(np.broadcast_to(mk, S.shape), 0, 1)
        nrm[ys, xs] = n
    return alb, rough, metal, nrm, mask


def poly_mesh(name, polys, mat=None):
    """polys: [(verts in game axes, uvs, smooth_group or None)]. Vertices are welded (by position, 0.1 mm) only inside
    one smooth group; None = flat, never welded. One UV map; a polygon is smooth when it has a group."""
    verts, faces, uvs, smooth, keys = [], [], [], [], {}
    for q, uv, grp in polys:
        f = []
        for v in q:
            if grp is None:
                verts.append(g2b(v)); f.append(len(verts) - 1)
                continue
            k = (grp,) + tuple(int(round(c * 1e4)) for c in v)
            if k not in keys:
                verts.append(g2b(v)); keys[k] = len(verts) - 1
            f.append(keys[k])
        faces.append(tuple(f))
        uvs.extend(uv)
        smooth.append(grp is not None)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    me.validate(clean_customdata=False)
    layer = me.uv_layers.new(name='UVMap')
    layer.data.foreach_set('uv', [float(c) for u in uvs for c in u])
    for poly, sm in zip(me.polygons, smooth):
        poly.use_smooth = sm
    if mat:
        me.materials.append(mat)
    me.update()
    return me


def box_faces(pid, size, kinds, seed=0.0):
    """Atlas faces of an axis-aligned box part: one per face key whose kind is not None. size = (x, y, z) m.
    Face (w, h): +-x -> (z, y), +-y -> (x, z), +-z -> (x, y)."""
    dims = {'x': (size[2], size[1]), 'y': (size[0], size[2]), 'z': (size[0], size[1])}
    out = []
    for key, kind in kinds.items():
        if kind is None:
            continue
        w, h = dims[key[1]]
        out.append(dict(id=f'{pid}{key}', kind=kind, w=w, h=h, key=key, part=pid, seed=seed))
    return out


def box_polys(pid, c, size, kinds, rects, atlas, faces_by_id, ch=0.0, grp=None, xf=None):
    """Polygons of an axis-aligned box part (game axes) with its faces' atlas UVs. ch > 0: chamfered edges (a strip per
    edge, a triangle per corner) that sample the texel at the nearest face's border. xf(v) optionally transforms every
    vertex (e.g. a rotation about the part's centre). Face-local (s, t): +x: s = -z..., chosen so s x t = outward N."""
    c = np.asarray(c, float); h = np.asarray(size, float) / 2
    polys = []
    # (axis, sign) -> (s axis, s sign, t axis, t sign): s runs along the face's width, t along its height
    frames = {'+x': (2, -1, 1, 1), '-x': (2, 1, 1, 1), '+y': (0, 1, 2, -1), '-y': (0, 1, 2, 1),
              '+z': (0, 1, 1, 1), '-z': (0, -1, 1, 1)}
    X = (lambda v: v) if xf is None else xf
    for key, (sa, ss, ta, ts) in frames.items():
        kind = kinds.get(key)
        if kind is None:
            continue
        a, sg = 'xyz'.index(key[1]), (1 if key[0] == '+' else -1)
        f = faces_by_id[f'{pid}{key}']
        q, uv = [], []
        for ds, dt in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v = c.copy()
            v[a] += sg * h[a]
            v[sa] += ss * ds * (h[sa] - ch)
            v[ta] += ts * dt * (h[ta] - ch)
            s_m = (ds + 1) / 2 * f['w'] + (-ds) * ch
            t_m = (dt + 1) / 2 * f['h'] + (-dt) * ch
            q.append(X(v)); uv.append(face_uv(rects[f['id']], f, s_m, t_m, atlas))
        polys.append((q, uv, grp))
    if ch > 0:
        # edge strips and corner triangles: UVs clamp to the nearest face border texel (worn edges come from the face)
        for a in range(3):
            b, d = [k for k in range(3) if k != a]
            for sb in (-1, 1):
                for sd in (-1, 1):
                    kb, kd = ('+' if sb > 0 else '-') + 'xyz'[b], ('+' if sd > 0 else '-') + 'xyz'[d]
                    if kinds.get(kb) is None and kinds.get(kd) is None:
                        continue
                    fk = kb if kinds.get(kb) is not None else kd
                    f = faces_by_id[f'{pid}{fk}']
                    p00 = c.copy(); p00[a] -= h[a] - ch; p00[b] += sb * h[b]; p00[d] += sd * (h[d] - ch)
                    p01 = c.copy(); p01[a] += h[a] - ch; p01[b] += sb * h[b]; p01[d] += sd * (h[d] - ch)
                    p11 = c.copy(); p11[a] += h[a] - ch; p11[b] += sb * (h[b] - ch); p11[d] += sd * h[d]
                    p10 = c.copy(); p10[a] -= h[a] - ch; p10[b] += sb * (h[b] - ch); p10[d] += sd * h[d]
                    q = [p00, p01, p11, p10]
                    nrm = np.zeros(3); nrm[b] = sb; nrm[d] = sd
                    if np.dot(np.cross(q[1] - q[0], q[2] - q[0]), nrm) < 0:
                        q = q[::-1]
                    uv = [edge_uv(rects[f['id']], f, v, c, h, fk, atlas) for v in q]
                    polys.append(([X(v) for v in q], uv, grp))
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    kx, ky, kz = ('+' if sx > 0 else '-') + 'x', ('+' if sy > 0 else '-') + 'y', ('+' if sz > 0 else '-') + 'z'
                    if all(kinds.get(k) is None for k in (kx, ky, kz)):
                        continue
                    fk = next(k for k in (ky, kx, kz) if kinds.get(k) is not None)
                    f = faces_by_id[f'{pid}{fk}']
                    s = np.array([sx, sy, sz], float)
                    tri = []
                    for a in range(3):
                        v = c + s * (h - ch); v[a] = c[a] + s[a] * h[a]
                        tri.append(v)
                    if np.dot(np.cross(tri[1] - tri[0], tri[2] - tri[0]), s) < 0:
                        tri = tri[::-1]
                    uv = [edge_uv(rects[f['id']], f, v, c, h, fk, atlas) for v in tri]
                    polys.append(([X(v) for v in tri], uv, grp))
    return polys


def edge_uv(rect, f, v, c, h, key, atlas):
    """UV of a chamfer vertex: its projection onto face `key`, clamped into the face (the border texel)."""
    frames = {'+x': (2, -1, 1, 1), '-x': (2, 1, 1, 1), '+y': (0, 1, 2, -1), '-y': (0, 1, 2, 1),
              '+z': (0, 1, 1, 1), '-z': (0, -1, 1, 1)}
    sa, ss, ta, ts = frames[key]
    s_m = np.clip((ss * (v[sa] - c[sa]) + h[sa]), 0, 2 * h[sa]) / (2 * h[sa]) * f['w']
    t_m = np.clip((ts * (v[ta] - c[ta]) + h[ta]), 0, 2 * h[ta]) / (2 * h[ta]) * f['h']
    return face_uv(rect, f, float(s_m), float(t_m), atlas)

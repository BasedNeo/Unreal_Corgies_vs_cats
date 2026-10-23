# bllib.py (W17 AAA, lane BL-DCC): the shared half of the tools/blender/*.py scripts, run inside Blender 5.2.2's own
# Python (`blender --background --factory-startup --python <script> -- <args>`; system Python has no bpy).
#
#   ROOT, LICENCE, SEED              the repo root, the licence line every receipt carries, the one seed
#   args(defaults)                   `-- --key value ...` parsed against typed defaults (every parameter is overridable)
#   lot() / floods() / bounds()      the shared world data: engines/godot/data/the_lot.json (never hand-typed numbers)
#   heights(lot)                     the Lot heights grid, checked against the sha256 the JSON records
#   g2b(p)                           game axes (x, y up, z) -> Blender axes (x, -z, y), the same map as tools/assets/kitlib
#   cycles(...) / quiet_metadata()   a fixed Cycles CPU setup and no stamp metadata, so two runs write the same bytes
#   pano_camera(...)                 an equirect camera rotated (90, 0, 180) deg: the image is in Godot's SKY_COORDS
#                                    (u = atan2(x, -z) / 2pi, v = acos(y) / pi), proved by sky_source.py --markers 1
#   sky_world(...)                   a Blender world that shows a SKY_COORDS equirect the right way round (for renders
#                                    lit by the sky SOURCE)
#   Clock / facts() / write_receipt  timings (wall, CPU of every thread, load at start), file facts, the receipt JSON
#
# The scripts are the source: no .blend is kept. Everything is seeded and single-valued, so a rebuild is reproducible.
import hashlib
import json
import math
import os
import sys
import time

import bpy

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
LOT_JSON = os.path.join('engines', 'godot', 'data', 'the_lot.json')
SEED = 1717
LICENCE = ('Original work of the Corgis vs Cats project, rendered by its own scripts with Blender 5.2.2 '
           '(GPL tool; outputs are ours); no third-party content')
BLENDER_REQUIRED = (5, 2, 2)


def args(defaults):
    """Parse `-- --key value ...` (after Blender's own `--`) against `defaults`; each value takes its default's type."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = dict(defaults)
    i = 0
    while i < len(argv):
        k = argv[i]
        if not k.startswith('--') or i + 1 >= len(argv):
            raise SystemExit(f'bad argument {k!r}: use --key value')
        k = k[2:]
        if k not in out:
            raise SystemExit(f'unknown parameter --{k} (known: {", ".join(sorted(out))})')
        t = type(out[k])
        out[k] = t(argv[i + 1])
        i += 2
    return out


def rel(path):
    """A repo-relative path when the file is inside the repo, else the absolute path."""
    a = os.path.abspath(path)
    return os.path.relpath(a, ROOT) if a.startswith(ROOT + os.sep) else a


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


# ------------------------------------------------------------------------------------------------ world data
def lot():
    """The Lot's shared world data (format cvc-lot/1, exported by tools/godot/export-lot.mjs from buildTheLot)."""
    path = os.path.join(ROOT, LOT_JSON)
    with open(path, encoding='utf8') as f:
        data = json.load(f)
    if data.get('format') != 'cvc-lot/1':
        raise SystemExit(f'{LOT_JSON}: unexpected format {data.get("format")!r}')
    data['_source'] = {'path': LOT_JSON, 'sha256': sha256(path)}
    return data


def floods(data):
    """The Lot's floodlight towers: [{id, team, pos (game xyz of the lamp bar), target}]."""
    return [dict(f) for f in data['floodlights']]


def bounds(data):
    """The play bounds (game metres): {minX, maxX, minZ, maxZ}."""
    return dict(data['bounds'])


def heights(data):
    """The terrain heights grid h[j, i] at game (x0 + i * cell, z0 + j * cell), checked against the JSON's sha256."""
    import numpy as np
    tr = data['terrain']
    path = os.path.join(ROOT, os.path.dirname(LOT_JSON), tr['heights'])
    digest = sha256(path)
    if digest != tr['sha256']:
        raise SystemExit(f'{rel(path)}: sha256 {digest} != the_lot.json terrain.sha256 {tr["sha256"]}')
    n = tr['n']
    return np.fromfile(path, dtype='<f4').reshape(n, n).astype(np.float64)


def g2b(p):
    """Game axes (x, y up, z) -> Blender axes (x, y back, z up)."""
    return (float(p[0]), -float(p[2]), float(p[1]))


# ------------------------------------------------------------------------------------------------ scene setup
def check_blender():
    if tuple(bpy.app.version) != BLENDER_REQUIRED:
        raise SystemExit(f'Blender {bpy.app.version_string} found; these scripts are pinned to 5.2.2 (outputs differ)')


def quiet_metadata(sc):
    """No stamp metadata (date, time, render time, host, file...) in the written files: two runs, same bytes."""
    r = sc.render
    for a in dir(r):
        if a.startswith('use_stamp'):
            setattr(r, a, False)
    r.dither_intensity = 0.0          # no dither noise in 8-bit outputs (smaller PNGs; the float data has none)


def cycles(sc, spp, seed=SEED, threads=4, adaptive_threshold=0.01, denoise=True, clamp_indirect=2.0):
    """A fixed Cycles CPU setup: seeded, fixed thread count, adaptive sampling, OIDN (albedo, accurate prefilter)."""
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = spp
    cy.seed = seed
    cy.use_animated_seed = False
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = adaptive_threshold
    cy.use_denoising = denoise
    if denoise:
        cy.denoiser = 'OPENIMAGEDENOISE'
        cy.denoising_input_passes = 'RGB_ALBEDO'
        cy.denoising_prefilter = 'ACCURATE'
    cy.sample_clamp_indirect = clamp_indirect
    cy.use_light_tree = True
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    quiet_metadata(sc)
    return cy


def view(sc, transform):
    """Scene view transform with no look, no exposure, gamma 1 (`Standard` = no tonemap; `AgX` for previews)."""
    v = sc.view_settings
    v.view_transform = transform
    v.look = 'None'
    v.exposure = 0.0
    v.gamma = 1.0
    sc.display_settings.display_device = 'sRGB'


# Camera euler (90, 0, 180) deg in Blender = Godot's sky axes: u = 0 looks down game -Z, u = 0.25 down +X, u = 0.5 down
# +Z, u = 0.75 down -X, v = 0 is straight up (proved with coloured markers in Blender and both Godot renderers in the
# W17 spike, and re-proved by `sky_source.py --markers 1`).
PANO_EULER_DEG = (90.0, 0.0, 180.0)


def pano_camera(sc, game_pos, name='Pano', clip_end=100000.0, wrap_px=0):
    """The equirect camera. wrap_px > 0 renders that many extra columns past each side of the +-180 deg seam (the
    longitude range and sc.render.resolution_x grow to match, pixel centres stay on the final grid), so the denoiser
    and the pixel filter see continuous sky across u = 0 / 1; render_exr(..., crop_x=wrap_px) cuts them off again."""
    cd = bpy.data.cameras.new(name)
    cd.type = 'PANO'
    cd.panorama_type = 'EQUIRECTANGULAR'
    cd.clip_start = 0.1
    cd.clip_end = clip_end
    if wrap_px:
        w = sc.render.resolution_x
        extra = 2 * math.pi * wrap_px / w
        cd.longitude_min, cd.longitude_max = -math.pi - extra, math.pi + extra
        sc.render.resolution_x = w + 2 * wrap_px
    co = bpy.data.objects.new(name, cd)
    co.location = g2b(game_pos)
    co.rotation_euler = tuple(math.radians(a) for a in PANO_EULER_DEG)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def sky_world(sc, exr_path, strength=1.0, name='SkySource'):
    """A world showing a SKY_COORDS equirect (the sky SOURCE) the right way round. Blender's environment lookup puts
    u = 0.5 on Blender +X; the SOURCE puts u = 0.5 on game +Z = Blender -Y, so the lookup turns +90 deg about +Z.
    Round trip checked by `sky_source.py --markers 1` (render the markers, show them as a world, re-render, same u;
    -90 deg fails it by exactly half a turn)."""
    w = bpy.data.worlds.new(name)
    sc.world = w
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0.0, 0.0, math.pi / 2)
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.abspath(exr_path), check_existing=True)
    env.image.colorspace_settings.name = 'Linear Rec.709'
    env.interpolation = 'Linear'
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def render_exr(sc, path_exr, clock, lap='render', crop_x=0):
    """Render the scene and write `path_exr` (OpenEXR, RGB half float, ZIP, scene-linear) with no render statistics in
    its header. Cycles always stamps its render, sync and total times into the result's metadata (the stamp switches
    do not cover them), so the render goes to a temporary EXR and its pixels are copied, bit for bit (half -> float32
    -> half is exact), into a plain float image that is saved instead; crop_x columns are cut from each side (the
    pano_camera wrap). Returns that image (for previews)."""
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.color_depth, s.exr_codec = 'OPEN_EXR', 'RGB', '16', 'ZIP'
    tmp = os.path.abspath(path_exr) + '.tmp.exr'
    sc.render.filepath = tmp
    clock.lap(lap, lambda: bpy.ops.render.render(write_still=True))
    src = bpy.data.images.load(tmp, check_existing=False)
    src.colorspace_settings.name = 'Linear Rec.709'
    w, h = src.size
    import numpy as np
    px = np.empty(w * h * 4, np.float32)
    src.pixels.foreach_get(px)
    px = np.ascontiguousarray(px.reshape(h, w, 4)[:, crop_x:w - crop_x]).ravel()
    w -= 2 * crop_x
    img = bpy.data.images.new(os.path.basename(path_exr), w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    img.pixels.foreach_set(px)
    bpy.data.images.remove(src)
    os.remove(tmp)
    img.save_render(os.path.abspath(path_exr), scene=sc)
    return img


def save_preview(sc, img, path_png, transform='AgX'):
    """An 8-bit PNG of a float image through the scene's view transform (`AgX` for eyes; data stays in the EXR)."""
    view(sc, transform)
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.color_depth, s.compression = 'PNG', 'RGB', '8', 100
    img.save_render(os.path.abspath(path_png), scene=sc)


def read_pixels(path):
    """A float image file as a numpy array (rows top first, RGB), values as stored (no colour conversion)."""
    import numpy as np
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    img.colorspace_settings.name = 'Linear Rec.709' if path.lower().endswith('.exr') else 'Non-Color'
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, :3].astype(np.float64)


# ------------------------------------------------------------------------------------------------ receipts
class Clock:
    """Wall and process CPU seconds (CPU summed over every render thread), and the load average at start."""

    def __init__(self):
        self.load_at_start = [round(x, 2) for x in os.getloadavg()]
        self.t0, self.c0 = time.time(), time.process_time()
        self.laps = {}

    def lap(self, name, fn):
        t, c = time.time(), time.process_time()
        r = fn()
        self.laps[name] = {'wall_s': round(time.time() - t, 2), 'cpu_s': round(time.process_time() - c, 2)}
        return r

    def total(self):
        return {'wall_s': round(time.time() - self.t0, 2), 'cpu_s': round(time.process_time() - self.c0, 2)}


def facts(path, **extra):
    """path (repo-relative), bytes, sha256, plus `extra` (resolution, encoding...)."""
    return {'path': rel(path), 'bytes': os.path.getsize(path), 'sha256': sha256(path), **extra}


def rebuild_command(script):
    """The command that rebuilt this output: $BLENDER is the Blender 5.2.2 binary, run from the repo root."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    tail = (' -- ' + ' '.join(argv)) if argv else ''
    return f'"$BLENDER" --background --factory-startup --python {rel(script)}{tail}'


def write_receipt(path, script, outputs, params, clock, **sections):
    """`<stem>.receipt.json`: outputs (path, bytes, sha256, size), every parameter, the rebuild command, the Blender
    version, wall and CPU seconds, load at start, and the licence line."""
    rec = {
        'kind': sections.pop('kind'),
        'outputs': outputs,
        'params': params,
        'rebuild': rebuild_command(script),
        'rebuild_env': {'BLENDER': 'the Blender 5.2.2 Linux x64 binary (blender.org release)', 'cwd': 'repo root'},
        'script': rel(script),
        'script_sha256': sha256(script),
        'bllib_sha256': sha256(os.path.abspath(__file__)),
        'blender': {'version': bpy.app.version_string, 'build_hash': bpy.app.build_hash.decode()},
        **sections,
        'timing': {'load_at_start': clock.load_at_start, **clock.laps, 'total': clock.total()},
        'licence': LICENCE,
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf8') as f:
        json.dump(rec, f, indent=1)
        f.write('\n')
    return rec

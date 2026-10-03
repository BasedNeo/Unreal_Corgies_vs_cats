#!/usr/bin/env python3
"""W15 p-art patch: proportion GUIDES for the image edits (free; Pillow + numpy). A guide is a crude warp of a kept image
toward the placeholder's proportions (engines/godot/game/pet_model.gd, condition/rig.json). It is an INPUT to an edit
call only; it is never delivered (it lives in $W15_ART_SCRATCH/guides/), and the ledger keeps its sha256.

Operations, applied in order per guide (coordinates are pixels of the raw source image):
- insert: [x0, x1, copies]  repeat the column band x0..x1 `copies` extra times (a longer torso, the texture kept)
- pad:    [top, bottom, left, right]  grow the canvas with the backdrop colour (room for taller ears or a tail)
- scale:  {poly, anchor, sx, sy, erase}  lift the pixels inside the polygon off the image and paste them back scaled about
          the anchor point (an ear about its root, a tail about its base); only foreground pixels are pasted; with erase the
          original is cleared first
- move:   {poly, dx, dy, fill_rows}  raise a region (a head) and fill the gap it leaves by stretching, per column, the
          `fill_rows` rows under the region's lower edge (a longer neck)
- tint:   {target, pale, exclude}  recolour the coat: low-saturation warm fur pixels (not the backdrop, not the armour or
          leather) take the target coat colour at their own luminance; the palest fur takes `pale`
Coordinates given after an `insert` or `pad` are in the source image's pixels: the tool shifts them itself.

Usage: W15_ART_SCRATCH=<dir> python3 tools/art/w15-guide.py <guide name> [...]   (names: see GUIDES; `all` for all)
"""
import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

SCRATCH = os.environ.get("W15_ART_SCRATCH") or os.path.join(tempfile.gettempdir(), "w15-char-refs")
RAW = os.path.join(SCRATCH, "raw")
OUT = os.path.join(SCRATCH, "guides")

# Specs are filled in from measured landmarks on each raw source (see docs/qa/w15/ART.md "Patch").
GUIDES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "w15-guides.json")))


def backdrop(a):
    corners = np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3),
                              a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)])
    return np.median(corners, axis=0)


def fg_mask(a, bg, tol=18.0):
    return np.abs(a.astype(np.float32) - bg).max(axis=2) > tol


def poly_mask(shape, poly):
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    return np.array(m) > 0


class Canvas:
    def __init__(self, img):
        self.a = np.array(img.convert("RGB")).astype(np.uint8)
        self.bg = backdrop(self.a)
        self.ox = 0  # source -> canvas offset
        self.oy = 0
        self.inserts = []  # (source x, width added)

    def X(self, x):
        dx = sum(w for sx, w in self.inserts if x > sx)
        return x + dx + self.ox

    def Y(self, y):
        return y + self.oy

    def P(self, poly):
        return [[self.X(x), self.Y(y)] for x, y in poly]

    def insert(self, x0, x1, copies):
        cx0, cx1 = self.X(x0), self.X(x1)
        band = self.a[:, cx0:cx1]
        self.a = np.concatenate([self.a[:, :cx1]] + [band] * copies + [self.a[:, cx1:]], axis=1)
        self.inserts.append((x1, (x1 - x0) * copies))

    def pad(self, top, bottom, left, right):
        h, w, _ = self.a.shape
        n = np.empty((h + top + bottom, w + left + right, 3), np.uint8)
        n[:] = self.bg.astype(np.uint8)
        n[top:top + h, left:left + w] = self.a
        self.a = n
        self.ox += left
        self.oy += top

    def scale(self, poly, anchor, sx, sy, erase=False):
        p = self.P(poly)
        ax, ay = self.X(anchor[0]), self.Y(anchor[1])
        m = poly_mask(self.a.shape, p) & fg_mask(self.a, self.bg)
        src = self.a.copy()
        if erase:  # clear the original first (a curled tail tip would otherwise show twice)
            self.a[m] = self.bg.astype(np.uint8)
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        x0, x1, y0, y1 = max(0, min(xs)), min(self.a.shape[1], max(xs) + 1), max(0, min(ys)), min(self.a.shape[0], max(ys) + 1)
        patch = Image.fromarray(src[y0:y1, x0:x1])
        pm = Image.fromarray((m[y0:y1, x0:x1] * 255).astype(np.uint8))
        nw, nh = max(1, round((x1 - x0) * sx)), max(1, round((y1 - y0) * sy))
        patch, pm = patch.resize((nw, nh), Image.LANCZOS), pm.resize((nw, nh), Image.LANCZOS)
        nx0, ny0 = round(ax + (x0 - ax) * sx), round(ay + (y0 - ay) * sy)
        img = Image.fromarray(self.a)
        img.paste(patch, (nx0, ny0), pm)
        self.a = np.array(img)

    def move(self, poly, dx, dy, fill_rows):
        """Raise a region (dy < 0): clear it, stretch the `fill_rows` rows under its lower edge (per column) up into
        the gap it leaves (a longer neck; background stays background), then paste it back at its new place."""
        p = self.P(poly)
        region = poly_mask(self.a.shape, p)
        m = region & fg_mask(self.a, self.bg)
        src = self.a.copy()
        h, w = m.shape
        self.a[m] = self.bg.astype(np.uint8)
        for x in np.nonzero(region.any(axis=0))[0]:
            ybot = int(np.nonzero(region[:, x])[0].max())
            top, bot = max(0, ybot + 1 + dy), min(h - 1, ybot + fill_rows)
            seg = src[ybot + 1:bot + 1, x].astype(np.float32)
            if len(seg) < 2 or bot <= top:
                continue
            t = np.linspace(0, len(seg) - 1, bot - top + 1)
            for c in range(3):
                self.a[top:bot + 1, x, c] = np.interp(t, np.arange(len(seg)), seg[:, c]).round().astype(np.uint8)
        ys, xs = np.nonzero(m)
        ty, tx = ys + dy, xs + dx
        ok = (ty >= 0) & (ty < h) & (tx >= 0) & (tx < w)
        self.a[ty[ok], tx[ok]] = src[ys[ok], xs[ok]]

    def tint(self, target, pale, exclude=None):
        a = self.a.astype(np.float32) / 255.0
        mx, mn = a.max(axis=2), a.min(axis=2)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        warm = (r >= b)  # the taupe coat leans red; the backdrop and steel do not
        fur = fg_mask(self.a, self.bg, 16.0) & warm & (sat < 0.32) & (mx > 0.12)
        if exclude:
            for poly in exclude:
                fur &= ~poly_mask(self.a.shape, self.P(poly))
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        t = np.array([int(target[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0
        pl = np.array([int(pale[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0
        t_l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]
        pl_l = 0.2126 * pl[0] + 0.7152 * pl[1] + 0.0722 * pl[2]
        k = np.clip((lum - 0.55) / 0.25, 0, 1)[..., None]  # pale fur (chest, muzzle) moves toward the pale colour
        col = (1 - k) * (t / t_l) * lum[..., None] + k * (pl / pl_l) * lum[..., None]
        a[fur] = np.clip(col[fur], 0, 1)
        self.a = (a * 255).round().astype(np.uint8)


def build(name):
    spec = GUIDES[name]
    c = Canvas(Image.open(os.path.join(RAW, spec["source"])))
    for op in spec["ops"]:
        kind, args = op[0], op[1]
        if kind == "insert":
            c.insert(*args)
        elif kind == "pad":
            c.pad(*args)
        elif kind == "scale":
            c.scale(args["poly"], args["anchor"], args.get("sx", 1.0), args.get("sy", 1.0), args.get("erase", False))
        elif kind == "move":
            c.move(args["poly"], args["dx"], args["dy"], args["fill_rows"])
        elif kind == "tint":
            c.tint(args["target"], args["pale"], args.get("exclude"))
        else:
            sys.exit(f"{name}: unknown op {kind}")
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.png")
    Image.fromarray(c.a).save(path, optimize=True)
    print(f"{name}: {spec['source']} -> guides/{name}.png {c.a.shape[1]}x{c.a.shape[0]} (offset {c.ox},{c.oy})")


if __name__ == "__main__":
    names = sys.argv[1:] or ["all"]
    for n in (GUIDES if names == ["all"] else names):
        build(n)

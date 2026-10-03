#!/usr/bin/env python3
"""W15 p-art patch: proportion and coat measurements for the reference sheets (free; Pillow + numpy).

Definitions (pixels of the image measured; the placeholder renders in condition/ are measured the same way, as targets):
- ground: the lowest silhouette pixel (the plain backdrop and its soft grey contact shadow are background).
- VB, the visible back: ground minus the highest silhouette pixel over the torso columns `torso` [x0, x1] (the top of
  the vest; rig.json's equivalent is the vest top: corgi 0.678 m, cat 0.80 m).
- tip: ground minus the highest silhouette pixel over `tip_cols` (the ear tip for a corgi, the tail tip for a cat);
  `ear_cols` likewise gives the cat's ear tip. Reported over VB.
- tail_over_ear (front and back views, cat): the tail tip's height over the ear tip's height (orthographic views keep
  heights; rig.json: 1.504 / 1.196 = 1.26).
- body: chest_x minus rump_x (manual landmarks: the rear-most point of the rump, not the tail; the chest's front, taken
  at the chest shield's rear edge, which covers it), over VB.
- E/H: ear length (ear tip to the midpoint of the ear's base, between its inner and outer roots) over head height
  (crown to chin); manual landmarks `ear_tip_y`, `ear_base_mid_y`, `crown_y`, `chin_y`.
- team share: the share of the silhouette in the team paint (blue H 200-250 deg, crimson H 335-12 deg; S > 0.35).
- coat: the median RGB of the coat pixels (foreground, saturation < 0.30, not the dark metal, not specular white),
  B - R and the hue of that median. Close-ups and night frames use a fur-only `coat_box` [x0, y0, x1, y1] instead.
Landmarks come from tools/art/w15-measure.json (read off 10-50 px grids by eye: about +-10 px, so ratios +-0.05).

Usage: W15_ART_SCRATCH=<dir> python3 tools/art/w15-measure.py [--json out.json]
"""
import colorsys
import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCRATCH = os.environ.get("W15_ART_SCRATCH") or os.path.join(tempfile.gettempdir(), "w15-char-refs")
SPEC = json.load(open(os.path.join(HERE, "w15-measure.json")))


def path_of(ref):
    if ref.startswith("raw:"):  # the scratch download, else the committed copy (kept images only)
        p = os.path.join(SCRATCH, "raw", ref[4:])
        return p if os.path.exists(p) else os.path.join(ROOT, "assets", "incoming", "w15-char-refs", "raw", ref[4:])
    return os.path.join(ROOT, ref)


def load(ref):
    a = np.array(Image.open(path_of(ref)).convert("RGB")).astype(np.float32)
    bg = np.median(np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3)]), axis=0)
    d = np.abs(a - bg).max(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    fg = (d > 40) | ((d > 22) & (sat > 25))
    return a, fg


def top_over(fg, cols):
    sub = fg[:, cols[0]:cols[1]]
    rows = np.nonzero(sub.any(axis=1))[0]
    return int(rows.min()) if len(rows) else None


def team_share(a, fg, team):
    im = Image.fromarray(a.astype(np.uint8)).convert("HSV")
    hsv = np.array(im).astype(np.float32)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    paint = ((h > 200) & (h < 250) & (s > 0.35) & (v > 0.15)) if team == "blue" else \
        (((h > 335) | (h < 12)) & (s > 0.35) & (v > 0.12))
    return float((paint & fg).sum() / max(1, fg.sum()))


def coat(a, fg, box=None):
    if box:  # a fur-only box (close-ups and night frames, where the corners are not the backdrop)
        x0, y0, x1, y1 = box
        a = a[y0:y1, x0:x1]
        fg = np.ones(a.shape[:2], bool)
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    lo = 40 if box else 60
    fur = fg & (sat < 0.30) & (mx > lo) & (mx < 235) & (np.abs(a - [60, 60, 62]).max(axis=2) > (0 if box else 25))
    r, g, b = (float(np.median(a[..., i][fur])) for i in range(3))
    hue = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)[0] * 360
    return {"median_rgb": [round(r), round(g), round(b)], "B_minus_R": round(b - r), "hue_deg": round(hue)}


def measure(name, m):
    a, fg = load(m["image"])
    out = {"image": m["image"], "view": m.get("view", "")}
    ys = np.nonzero(fg.any(axis=1))[0]
    ground = m.get("ground") or int(ys.max())
    out["ground"] = ground
    if "torso" in m:
        back = top_over(fg, m["torso"])
        vb = ground - back
        out["VB"] = vb
        if "tip_cols" in m:
            out["tip_over_VB"] = round((ground - top_over(fg, m["tip_cols"])) / vb, 2)
        if "ear_cols" in m:
            out["ear_tip_over_VB"] = round((ground - top_over(fg, m["ear_cols"])) / vb, 2)
        if "rump_x" in m and "chest_x" in m:
            out["body_over_VB"] = round((m["chest_x"] - m["rump_x"]) / vb, 2)
    elif "tip_cols" in m and "ear_cols" in m:  # front / back: heights over ground are kept by the projection
        out["tail_over_ear"] = round((ground - top_over(fg, m["tip_cols"])) / (ground - top_over(fg, m["ear_cols"])), 2)
    if "crown_y" in m:
        e = m["ear_base_mid_y"] - m["ear_tip_y"]
        h = m["chin_y"] - m["crown_y"]
        out["E_over_H"] = round(e / h, 2)
    if "team" in m:
        out["team_share"] = round(team_share(a, fg, m["team"]), 3)
    if m.get("coat"):
        out["coat"] = coat(a, fg, m.get("coat_box"))
    return out


def main():
    res = {k: measure(k, v) for k, v in SPEC.items() if not k.startswith("_") and os.path.exists(path_of(v["image"]))}
    w = max(len(k) for k in res)
    for k, v in res.items():
        cols = {x: v[x] for x in ("VB", "body_over_VB", "tip_over_VB", "ear_tip_over_VB", "tail_over_ear", "E_over_H",
                                  "team_share") if x in v}
        if "coat" in v:
            cols["coat_B-R"] = v["coat"]["B_minus_R"]
            cols["coat_hue"] = v["coat"]["hue_deg"]
        print(f"{k:{w}s}  " + "  ".join(f"{x}={y}" for x, y in cols.items()))
    if "--json" in sys.argv:
        json.dump(res, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()

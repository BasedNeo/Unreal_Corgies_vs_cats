#!/usr/bin/env python3
"""W15 p-art: deliver the KEPT reference images and the contact sheet (no API calls, no cost).

Reads assets/incoming/w15-char-refs/ledger.jsonl (written by tools/art/grok-sheets.mjs). Every output marked kept with a
`delivered` path is converted from its raw download ($W15_ART_SCRATCH/raw/<file>) to a JPEG at quality 88, longest side
at most 1536 px (downscale only, Lanczos), no metadata, at assets/incoming/w15-char-refs/<delivered>. The delivered
file's sha256 and size go back into the ledger next to the raw file's. JPEGs in corgi/ and cat/ that are no longer
kept are removed. Then docs/qa/w15/art-contact-sheet.jpg is drawn: every kept image, labelled, at most 600 KB.
The ledger is written under the same exclusive lock as tools/art/grok-sheets.mjs (<ledger>.lock, O_EXCL): a held lock
exits 3 with the ledger untouched; the new ledger goes to <ledger>.tmp and replaces the old one by rename.
W15_ART_OUT overrides the ledger's folder (the tests use a temp ledger).

Usage (from the repo root; needs Python 3 and Pillow): W15_ART_SCRATCH=<scratch dir> python3 tools/art/w15-export.py
"""
import hashlib
import io
import json
import os
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.abspath(os.environ["W15_ART_OUT"]) if os.environ.get("W15_ART_OUT") else \
    os.path.join(ROOT, "assets", "incoming", "w15-char-refs")
LEDGER = os.path.join(OUT, "ledger.jsonl")
LOCK = LEDGER + ".lock"
SCRATCH = os.environ.get("W15_ART_SCRATCH") or os.path.join(tempfile.gettempdir(), "w15-char-refs")
SHEET = os.path.join(ROOT, "docs", "qa", "w15", "art-contact-sheet.jpg")
MAX_SIDE = 1536
QUALITY = 88
SHEET_MAX_BYTES = 600 * 1024
ORDER = ["master_threequarter", "front", "side_right", "back", "detail_head", "detail_armour", "detail_rifle_mount",
         "insitu_wet_night"]
LABEL = {
    "master_threequarter": "master, front 3/4",
    "front": "front",
    "side_right": "side (right)",
    "back": "back",
    "detail_head": "head",
    "detail_armour": "vest + chest shield",
    "detail_rifle_mount": "rifle on harness mount",
    "insitu_wet_night": "in-situ: wet night",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/Library/Fonts", "C:/Windows/Fonts"):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def deliver(rows):
    delivered = []
    for r in rows:
        for o in r.get("outputs", []):
            if o.get("kept") is not True or not o.get("delivered"):
                continue
            src = os.path.join(SCRATCH, o["file"])
            if not os.path.exists(src):
                sys.exit(f"missing raw download {src} (set W15_ART_SCRATCH)")
            if sha256(src) != o["sha256"]:
                sys.exit(f"{src} does not match the ledger's sha256")
            dst = os.path.join(OUT, o["delivered"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            im = Image.open(src).convert("RGB")
            scale = min(1.0, MAX_SIDE / max(im.size))
            if scale < 1.0:
                im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
            im.save(dst, "JPEG", quality=QUALITY, optimize=True)
            o["delivered_sha256"] = sha256(dst)
            o["delivered_px"] = f"{im.width}x{im.height}"
            o["delivered_bytes"] = os.path.getsize(dst)
            delivered.append((o["delivered"], r["call_id"], o))
    keep = {d for d, _, _ in delivered}
    for sub in ("corgi", "cat"):
        folder = os.path.join(OUT, sub)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            rel = f"{sub}/{name}"
            if name.lower().endswith(".jpg") and rel not in keep:
                os.remove(os.path.join(folder, name))
                print(f"removed stale {rel}")
    return delivered


# One short measured line per cell (docs/qa/w15/ART.md has the full table; tools/art/w15-measure.py the method).
NOTES = {
    "corgi/corgi_master_threequarter.jpg": "E/H 1.11 (<1.35)",
    "corgi/corgi_front.jpg": "E/H 1.04 (<1.35)",
    "corgi/corgi_side_right.jpg": "PASS body/VB 1.92 tip 1.96 E/H 1.42",
    "corgi/corgi_back.jpg": "E/H 1.29 (<1.35)",
    "corgi/corgi_detail_head.jpg": "E/H 0.93 (<1.35)",
    "corgi/corgi_detail_armour.jpg": "unchanged (round 1)",
    "corgi/corgi_detail_rifle_mount.jpg": "unchanged (round 1)",
    "corgi/corgi_insitu_wet_night.jpg": "unchanged (round 1)",
    "cat/cat_master_threequarter.jpg": "PASS tail/VB 1.80 ear 1.31; B-R +9",
    "cat/cat_front.jpg": "PASS tail/ear 1.23; B-R +13",
    "cat/cat_side_right.jpg": "PASS tail/VB 1.88 ear 1.50; B-R +15",
    "cat/cat_back.jpg": "PASS tail/ear 1.25; B-R +9",
    "cat/cat_detail_head.jpg": "coat B-R +10, hue 210",
    "cat/cat_detail_armour.jpg": "coat B-R +11, hue 229",
    "cat/cat_detail_rifle_mount.jpg": "coat B-R +7, hue 231",
    "cat/cat_insitu_wet_night.jpg": "coat B-R +27, hue 224",
}
ROWS = {
    "corgi": "Corgi Company corgi - PATH B: design / material reference only; proportions from condition/ + rig.json",
    "cat": "Cat Cadre cat - PATH A: proportions and coat measured against the placeholder",
}


def contact_sheet(delivered):
    by = {}
    for rel, call, o in delivered:
        who, name = rel.split("/")
        key = name[len(who) + 1:-4]
        by.setdefault(who, {})[key] = (rel, call)
    cols, cell_w, cell_h, label_h, pad, head_h = len(ORDER), 300, 300, 62, 10, 64
    row_h = 24
    W = cols * (cell_w + pad) + pad
    H = head_h + 2 * (row_h + cell_h + label_h + pad) + pad
    sheet = Image.new("RGB", (W, H), (34, 34, 36))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 12), "Corgis vs Cats - W15 character reference sheets (KEPT images; reference only, not shipped)",
           fill=(235, 235, 235), font=font(22, True))
    d.text((pad, 40), "xAI Grok Imagine (grok-imagine-image-2.0), 2026-10-01 and 2026-10-03 (W15 patch). Label: view, file, "
           "ledger call, measured check (docs/qa/w15/ART.md).", fill=(170, 170, 170), font=font(15))
    small = font(15)
    for row, who in enumerate(("corgi", "cat")):
        y0 = head_h + row * (row_h + cell_h + label_h + pad)
        d.text((pad, y0 + 2), ROWS[who], fill=(120, 200, 255) if who == "corgi" else (255, 150, 160), font=font(16, True))
        y0 += row_h
        for col, key in enumerate(ORDER):
            x0 = pad + col * (cell_w + pad)
            if key not in by.get(who, {}):
                d.rectangle([x0, y0, x0 + cell_w, y0 + cell_h], outline=(90, 60, 60))
                d.text((x0 + 8, y0 + 8), "missing", fill=(220, 120, 120), font=small)
                continue
            rel, call = by[who][key]
            im = Image.open(os.path.join(OUT, rel)).convert("RGB")
            s = min(cell_w / im.width, cell_h / im.height)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            sheet.paste(im, (x0 + (cell_w - im.width) // 2, y0 + (cell_h - im.height) // 2))
            d.text((x0 + 2, y0 + cell_h + 4), f"{who}: {LABEL[key]}", fill=(235, 235, 235), font=font(15, True))
            d.text((x0 + 2, y0 + cell_h + 24), f"{rel.split('/')[1]}  ({call})", fill=(160, 160, 160), font=font(12))
            note = NOTES.get(rel, "")
            d.text((x0 + 2, y0 + cell_h + 42), note, fill=(150, 230, 150) if note.startswith("PASS") or "coat" in note
                   else (230, 200, 120), font=font(12))
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    for q in (85, 80, 75, 70, 65, 60):
        buf = io.BytesIO()
        sheet.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= SHEET_MAX_BYTES:
            break
    with open(SHEET, "wb") as f:
        f.write(buf.getvalue())
    print(f"contact sheet {os.path.relpath(SHEET, ROOT)}: {sheet.width}x{sheet.height}, {buf.tell()} bytes, quality {q}")
    if buf.tell() > SHEET_MAX_BYTES:
        sys.exit("contact sheet is over 600 KB")


def main():
    try:  # the ledger's one-writer lock, shared with grok-sheets.mjs ('wx'), taken before the ledger is read
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        print(f"LOCKED: {LOCK} exists (another run holds the ledger, or a crashed run left it: check, then delete it). "
              "Ledger untouched.")
        sys.exit(3)
    try:
        os.write(fd, f"{os.getpid()} w15-export\n".encode())
        os.close(fd)
        rows = [json.loads(line) for line in open(LEDGER) if line.strip()]
        delivered = deliver(rows)
        tmp = LEDGER + ".tmp"
        with open(tmp, "w") as f:
            f.write("".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in rows))
        os.replace(tmp, LEDGER)
        for rel, call, o in sorted(delivered):
            print(f"{rel:42s} {o['delivered_px']:>10s} {o['delivered_bytes']:>8d} B  from {o['file']}")
        contact_sheet(delivered)
    finally:
        os.unlink(LOCK)


if __name__ == "__main__":
    main()

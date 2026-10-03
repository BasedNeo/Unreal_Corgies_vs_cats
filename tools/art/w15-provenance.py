#!/usr/bin/env python3
"""W15 p-art patch: provenance for the kept reference images (no API calls, no cost).

For every output marked kept in assets/incoming/w15-char-refs/ledger.jsonl, from its RAW download (the API's own file,
in $W15_ART_SCRATCH/raw/):
- exports the embedded C2PA manifest store (read and validated with the c2pa-python reader) to
  assets/incoming/w15-char-refs/provenance/<delivered name>.c2pa.json, with the raw file's sha256 and call id;
- copies the raw file byte for byte to assets/incoming/w15-char-refs/raw/<raw name>, if all kept raws together are at
  most RAW_BUDGET bytes (15 MB); otherwise it copies none and says so.
Stale files in provenance/ and raw/ (no longer kept) are removed. The delivered JPEGs (w15-export.py re-encodes them)
carry no C2PA data; the raw copies and these JSON files are the provenance.

Usage (from the repo root; c2pa-python 0.38 in any venv: pip install c2pa-python):
  W15_ART_SCRATCH=<scratch dir> <venv>/bin/python tools/art/w15-provenance.py
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile

import c2pa

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "incoming", "w15-char-refs")
LEDGER = os.path.join(OUT, "ledger.jsonl")
SCRATCH = os.environ.get("W15_ART_SCRATCH") or os.path.join(tempfile.gettempdir(), "w15-char-refs")
RAW_BUDGET = 15 * 1024 * 1024


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main():
    rows = [json.loads(l) for l in open(LEDGER) if l.strip()]
    kept = [(r["call_id"], o) for r in rows for o in r.get("outputs", []) if o.get("kept") is True and o.get("delivered")]
    prov_dir, raw_dir = os.path.join(OUT, "provenance"), os.path.join(OUT, "raw")
    os.makedirs(prov_dir, exist_ok=True)
    total = sum(os.path.getsize(os.path.join(SCRATCH, o["file"])) for _, o in kept)
    copy_raw = total <= RAW_BUDGET
    want_prov, want_raw = set(), set()
    for call, o in kept:
        src = os.path.join(SCRATCH, o["file"])
        if sha256(src) != o["sha256"]:
            sys.exit(f"{src} does not match the ledger's sha256")
        reader = c2pa.Reader.from_file(src) if hasattr(c2pa.Reader, "from_file") else c2pa.Reader(src)
        store = json.loads(reader.json())
        name = os.path.splitext(os.path.basename(o["delivered"]))[0] + ".c2pa.json"
        doc = {"delivered": o["delivered"], "call_id": call, "raw_file": os.path.basename(o["file"]),
               "raw_sha256": o["sha256"], "reader": f"c2pa-python {getattr(c2pa, '__version__', '?')}",
               "manifest_store": store}
        with open(os.path.join(prov_dir, name), "w") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False)
            f.write("\n")
        want_prov.add(name)
        active = store["manifests"][store["active_manifest"]]
        agent = active["assertions"][0]["data"]["actions"][0]
        print(f"{name:40s} {agent['action']} by {agent.get('softwareAgent')} ({agent.get('digitalSourceType', '').rsplit('/', 1)[-1]}), "
              f"validation: {[v['code'] for v in store.get('validation_status', [])]}")
        if copy_raw:
            os.makedirs(raw_dir, exist_ok=True)
            dst = os.path.join(raw_dir, os.path.basename(o["file"]))
            shutil.copyfile(src, dst)
            want_raw.add(os.path.basename(o["file"]))
    for d, want in ((prov_dir, want_prov), (raw_dir, want_raw)):
        if os.path.isdir(d):
            for n in sorted(os.listdir(d)):
                if n not in want:
                    os.remove(os.path.join(d, n))
                    print(f"removed stale {os.path.relpath(os.path.join(d, n), OUT)}")
    print(f"kept raws: {len(kept)} files, {total} bytes -> " + ("copied to raw/" if copy_raw else
          f"NOT copied (over the {RAW_BUDGET} byte allowance); provenance JSON only"))


if __name__ == "__main__":
    main()

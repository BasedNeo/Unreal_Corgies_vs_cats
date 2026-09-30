#!/usr/bin/env bash
# tools/godot/run.sh (W11 P-GLB1): Godot 4 headless import + validation of one GLB.
#   GODOT=/path/to/Godot_v4.x-stable_linux.x86_64 bash tools/godot/run.sh <file.glb> [assets/manifest.json]
# 1. copies the GLB into tools/godot/_import/ (gitignored) and runs the editor import (--import): the real import
#    pipeline an artist gets (GLB -> .scn), 2. runs validate_glb.gd, which loads the imported scene AND parses the same
#    file at runtime (GLTFDocument), prints the tree, AABB (m), LOD count, triangles and materials, exits 0 / 1.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
glb="${1:?usage: run.sh <file.glb> [manifest.json]}"
manifest="${2:-$repo/assets/manifest.json}"
godot="${GODOT:-godot}"
name="$(basename "$glb")"
mkdir -p "$here/_import"
if [ -n "$name" ] && [ -f "$here/_import/$name" ]; then rm -f "$here/_import/$name" "$here/_import/$name.import"; fi
cp "$glb" "$here/_import/$name"
"$godot" --headless --path "$here" --import > "$here/_import/import.log" 2>&1 || true
grep -iE "error|warning" "$here/_import/import.log" | grep -v "^$" | head -20 || true
"$godot" --headless --path "$here" --script res://validate_glb.gd -- "res://_import/$name" "$(cd "$(dirname "$glb")" && pwd)/$name" "$manifest"

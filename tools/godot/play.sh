#!/usr/bin/env bash
# Launch the Godot game (Wave 12): finds a Godot 4 binary and opens engines/godot.
#   npm run godot            (or GODOT=/path/to/Godot bash tools/godot/play.sh)
#   extra args pass through, e.g. -- --shot artifacts/godot/boot.png
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
cands=("${GODOT:-}" "$(command -v godot4 || true)" "$(command -v godot || true)" \
  "/Applications/Godot.app/Contents/MacOS/Godot" "$HOME/Applications/Godot.app/Contents/MacOS/Godot")
for g in "${cands[@]}"; do [ -n "$g" ] && [ -x "$g" ] && exec "$g" --path "$here/engines/godot" "$@"; done
echo "Godot 4.x not found. Install it from https://godotengine.org/download, then run: GODOT=/path/to/Godot npm run godot" >&2
exit 1

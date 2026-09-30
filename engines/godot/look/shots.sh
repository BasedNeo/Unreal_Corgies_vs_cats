#!/usr/bin/env bash
# G-LOOK bookmark shots + render stats, look on vs off (Wave 12). From the repo root:
#   GODOT=/path/to/godot bash engines/godot/look/shots.sh [compat|fplus] [on|off] [bookmark...]
# Bookmarks are the web game's own (data/the_lot.json "bookmarks"): canyon = lot_container_canyon,
# overview = lot_overview, base = lot_corgi_base (the pit, its floods and the slab side). Shots land in
# artifacts/godot/look_<on|off>_<bookmark>_<renderer>.png; each run prints one "LOOK stats" line (draws, objects,
# primitives, CPU frame ms over the 3 frames after the bookmark camera goes live).
set -u
GODOT=${GODOT:-godot}
R=${1:-compat}; MODE=${2:-on}; shift $(( $# > 2 ? 2 : $# ))
BOOKS=${*:-canyon overview base}
if [ "$R" = fplus ]; then RA="--rendering-method forward_plus --rendering-driver vulkan"
else RA="--rendering-method gl_compatibility --rendering-driver opengl3"; fi
declare -A CAM=( [canyon]="-85,2.4,-58:-78,9,60" [overview]="3.28,114,130.45:-26,-2,-46" [base]="13,1.9,-104.5:-50,-2.2,-113" )
RUN=""; command -v xvfb-run >/dev/null && [ -z "${DISPLAY:-}" ] && RUN="xvfb-run -a -s '-screen 0 1280x720x24'"
for b in $BOOKS; do
  eval $RUN "$GODOT" --path engines/godot $RA --audio-driver Dummy -- --shot "artifacts/godot/look_${MODE}_${b}_${R}.png" \
    --frames "${FRAMES:-60}" --cam "${CAM[$b]}" --look-stats --look "$MODE" 2>&1 | grep -E "^(PROOF|LOOK)"
done

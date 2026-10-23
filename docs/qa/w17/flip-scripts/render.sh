#!/usr/bin/env bash
# QA-FLIP (docs/qa/w17/QA-FLIP.md): render.sh <tree> <compat|fplus> <outdir> <log> [mask]
# Renders qaflip_views.gd's four views from a PRIVATE archive copy <tree> (git archive + Godot --import; the script
# copied to <tree>/engines/godot/), one Godot at a time at nice 10, after waiting for load5 < 7 (the box's bar is 8).
# Without "mask": the normal frames (NO_MASK=1); with it: the depth sky masks. GODOT = the Godot 4.7.2 binary.
set -u
G=${GODOT:?set GODOT to the Godot 4.7.2 binary}
T=$1; R=$2; O=$3; L=$4; M=${5:-}
while [ "$(cut -d' ' -f2 /proc/loadavg | cut -d. -f1)" -ge 7 ]; do sleep 20; done
if [ "$R" = fplus ]; then RA="--rendering-method forward_plus --rendering-driver vulkan"; else RA="--rendering-method gl_compatibility --rendering-driver opengl3"; fi
mkdir -p "$O"; cd "$T/engines/godot" || exit 2
start=$(date +%s)
NO_MASK=$([ "$M" = mask ] || echo 1) MASK_DIR="$O" nice -n 10 timeout 900 xvfb-run -a -s "-screen 0 1280x720x24" "$G" --path . $RA \
  --audio-driver Dummy --resolution 1280x720 --script res://qaflip_views.gd > "$L" 2>&1
echo "$(basename "$O") rc=$? $(( $(date +%s) - start ))s load $(cut -d' ' -f1-3 /proc/loadavg) :: $(grep -c '^MASK' "$L") views"

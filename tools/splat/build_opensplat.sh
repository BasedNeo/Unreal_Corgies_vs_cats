#!/usr/bin/env bash
# build_opensplat.sh (W17 AAA pass 4 SPLAT, lane BL-DCC): a fetch-and-build RECIPE for OpenSplat 1.2.2 on the CPU.
#
# NOT RUN. OpenSplat is AGPL-3.0, and fine-tuning the backdrop splat waits on the owner's sign-off (AAA_PLAN
# "Decisions for the owner" 1). The shipped splat (assets/backdrop/lot_backdrop_untrained.spz) is BAKED by
# tools/splat/bake_splat.py and needs none of this. Nothing OpenSplat builds or writes may land in the repo: the
# build directory is a path the caller passes and the script refuses one inside the repo.
#
# Usage, only after the sign-off:
#   OPENSPLAT_SIGNOFF=yes bash tools/splat/build_opensplat.sh <build-dir outside the repo>
# Then (still outside the repo; the training set from tools/blender/splat_set.py):
#   <build-dir>/OpenSplat/build/opensplat <scratch>/train -n 2000 -o <scratch>/fine.ply
# Known gap before a fine-tune: OpenSplat's nerfstudio reader needs sparse points (transforms.json "ply_file_path";
# random initialisation is not supported, OpenSplat issue 7). splat_set.py writes none; the bake's splat centres are
# the obvious seed. The trained output then goes through the same crop, budget and spz_check.mjs as the bake.
#
# Pins (checked 2026-10-23):
#   OpenSplat tag v1.2.2 = commit 62fd86fe3b62644b65890557ad9bf397abdc7cfb (github.com/pierotofy/OpenSplat), AGPL-3.0
#   libtorch 2.2.1 CPU, cxx11 ABI, shared with deps (download.pytorch.org), 182,681,505 bytes,
#     sha256 13b7f53cdedf83ca6b8fa86a0011889a9c025ce49d8da531fea926f0bdfdca01
#   system: cmake >= 3.21, a C++17 compiler, libopencv-dev, unzip, git, sha256sum
set -euo pipefail

OPENSPLAT_TAG=v1.2.2
OPENSPLAT_COMMIT=62fd86fe3b62644b65890557ad9bf397abdc7cfb
LIBTORCH_URL='https://download.pytorch.org/libtorch/cpu/libtorch-cxx11-abi-shared-with-deps-2.2.1%2Bcpu.zip'
LIBTORCH_SHA256=13b7f53cdedf83ca6b8fa86a0011889a9c025ce49d8da531fea926f0bdfdca01

die() { echo "build_opensplat: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || die "usage: OPENSPLAT_SIGNOFF=yes bash tools/splat/build_opensplat.sh <build-dir outside the repo>"
[ "${OPENSPLAT_SIGNOFF:-}" = yes ] || die "not signed off: OpenSplat is AGPL-3.0 and the fine-tune waits on the owner (AAA_PLAN decision 1)"

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
BUILD=$(realpath -m "$1")
case "$BUILD/" in
  "$REPO"/*) die "the build dir $BUILD is inside the repo $REPO: pass a scratch path" ;;
esac
mkdir -p "$BUILD"
BUILD=$(cd "$BUILD" && pwd -P)
case "$BUILD/" in
  "$REPO"/*) die "the build dir $BUILD resolves inside the repo $REPO" ;;
esac
for tool in cmake git unzip curl sha256sum make; do
  command -v "$tool" >/dev/null || die "missing $tool"
done
pkg-config --exists opencv4 2>/dev/null || echo "build_opensplat: warning: opencv4 not found by pkg-config (apt install libopencv-dev)" >&2

cd "$BUILD"
# 1. libtorch (CPU), checked against the pinned hash
if [ ! -d libtorch ]; then
  curl -fL --retry 3 -o libtorch.zip "$LIBTORCH_URL"
  echo "$LIBTORCH_SHA256  libtorch.zip" | sha256sum -c - || die "libtorch hash mismatch"
  unzip -q libtorch.zip
  rm libtorch.zip
fi

# 2. OpenSplat at the pinned tag, checked against the pinned commit
if [ ! -d OpenSplat ]; then
  git clone --depth 1 --branch "$OPENSPLAT_TAG" https://github.com/pierotofy/OpenSplat.git OpenSplat
fi
HEAD_COMMIT=$(git -C OpenSplat rev-parse HEAD)
[ "$HEAD_COMMIT" = "$OPENSPLAT_COMMIT" ] || die "OpenSplat $OPENSPLAT_TAG is $HEAD_COMMIT, expected $OPENSPLAT_COMMIT"

# 3. CPU build (GPU_RUNTIME=CPU: no CUDA, HIP or Metal)
cmake -S OpenSplat -B OpenSplat/build -DCMAKE_PREFIX_PATH="$BUILD/libtorch" -DGPU_RUNTIME=CPU -DCMAKE_BUILD_TYPE=Release
cmake --build OpenSplat/build -j"$(nproc)"
echo "build_opensplat: built $BUILD/OpenSplat/build/opensplat ($OPENSPLAT_TAG, CPU, libtorch 2.2.1)"

#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)

"$script_dir/generate-config-header.sh"

"$app_dir/scripts/bootstrap.sh"
(
  cd "$repo_dir/packages/console-ui"
  zig build console-core \
    -Dconsole-target=x86-uefi-msvc \
    -Dconsole-cpu=pentium3 \
    -Dconsole-optimize=ReleaseFast
)
PATH="$app_dir/.nxdk/bin:$PATH" make -C "$app_dir" NXDK_DIR="$app_dir/.nxdk"

test -s "$app_dir/Multiplex.iso"
echo "Built $app_dir/Multiplex.iso"

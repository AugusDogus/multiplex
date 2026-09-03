#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
ui_dir="$repo_dir/packages/console-ui"
nxdk_dir="$app_dir/.nxdk"
output="$app_dir/multiplex-xbox-native-reference.xbe"

"$script_dir/generate-config-header.sh"

if [ ! -d "$nxdk_dir/.git" ] || [ ! -d "$ui_dir/.native-sdk/.git" ]; then
  echo "Pinned Xbox dependencies are missing. Run bun run xbox:bootstrap first." >&2
  exit 1
fi

(
  cd "$ui_dir"
  # nxdk links COFF objects with the 32-bit Microsoft C ABI. Zig's UEFI target
  # supplies that format and ABI without adding desktop Windows imports.
  zig build console-core \
    -Dconsole-target=x86-uefi-msvc \
    -Dconsole-cpu=pentium3 \
    -Dconsole-optimize=ReleaseFast
)

PATH="$nxdk_dir/bin:$PATH" make -C "$app_dir" NXDK_DIR="$nxdk_dir"
cp "$app_dir/bin/default.xbe" "$output"

test -s "$output"
xbe_size=$(wc -c <"$output")
echo "Original Xbox XBE is ready at $output ($xbe_size bytes)."

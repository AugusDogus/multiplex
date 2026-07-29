#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

for command in cmake git ninja; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to build the patched Dolphin emulator." >&2
    exit 1
  fi
done

system_data=/usr/share/dolphin-emu/sys
for firmware in dsp_coef.bin dsp_rom.bin; do
  if [ ! -s "$system_data/GC/$firmware" ]; then
    echo "Dolphin 2606 system data is missing $system_data/GC/$firmware." >&2
    echo "Install the distribution's Dolphin data package before building." >&2
    exit 1
  fi
done

dolphin_dir="$spike_dir/.dolphin-source-2606"
dolphin_url=https://github.com/dolphin-emu/dolphin.git
patch_file="$spike_dir/patches/dolphin-2606-tap-receive-backpressure.patch"
build_dir="$dolphin_dir/build"
binary="$build_dir/Binaries/dolphin-emu"
stamp="$build_dir/.multiplex-build-input"
build_input="system-data-v2 $DOLPHIN_COMMIT $(cksum "$patch_file")"

if [ ! -d "$dolphin_dir/.git" ]; then
  if [ -e "$dolphin_dir" ]; then
    echo "$dolphin_dir exists but is not a Dolphin git checkout." >&2
    exit 1
  fi
  git clone --depth 1 --branch 2606 --recurse-submodules --shallow-submodules \
    "$dolphin_url" "$dolphin_dir"
fi

actual_commit=$(git -C "$dolphin_dir" rev-parse HEAD)
if [ "$actual_commit" != "$DOLPHIN_COMMIT" ]; then
  echo "Dolphin checkout is at $actual_commit; expected $DOLPHIN_COMMIT." >&2
  exit 1
fi

if git -C "$dolphin_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
  :
elif git -C "$dolphin_dir" apply --check "$patch_file"; then
  git -C "$dolphin_dir" apply "$patch_file"
else
  echo "Dolphin patch does not apply cleanly: $patch_file" >&2
  exit 1
fi

if [ ! -x "$binary" ] ||
  [ ! -f "$stamp" ] ||
  [ "$(sed -n '1p' "$stamp")" != "$build_input" ]; then
  cmake -S "$dolphin_dir" -B "$build_dir" -G Ninja \
    -DCMAKE_INSTALL_PREFIX=/usr \
    -DCMAKE_BUILD_TYPE=Release \
    -Ddatadir=/usr/share/dolphin-emu \
    -DENABLE_ANALYTICS=OFF \
    -DENABLE_AUTOUPDATE=OFF \
    -DENABLE_TESTS=OFF \
    -DLINUX_LOCAL_DEV=OFF \
    -DUSE_DISCORD_PRESENCE=OFF \
    -DUSE_RETRO_ACHIEVEMENTS=OFF
  cmake --build "$build_dir" --target dolphin-emu
  printf '%s\n' "$build_input" >"$stamp"
fi

test -x "$binary"
echo "Patched Dolphin $DOLPHIN_COMMIT is ready at $binary."

#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

for command in bash curl make patch sha256sum tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to install the Dreamcast toolchain." >&2
    exit 1
  fi
done

toolchain_dir="$app_dir/.dreamcast-toolchain"
toolchain_archive="$toolchain_dir/toolchain.tar.gz"
toolchain_url="https://github.com/drpaneas/dreamcast-toolchain-builds/releases/download/$DREAMCAST_TOOLCHAIN_VERSION/dreamcast-toolchain-$DREAMCAST_TOOLCHAIN_VERSION-linux-x86_64.tar.gz"

mkdir -p "$toolchain_dir"
if [ ! -s "$toolchain_archive" ]; then
  partial_archive="$toolchain_archive.partial"
  trap 'rm -f "$partial_archive"' EXIT HUP INT TERM
  curl --fail --location --retry 3 --output "$partial_archive" \
    "$toolchain_url"
  mv "$partial_archive" "$toolchain_archive"
  trap - EXIT HUP INT TERM
fi
printf '%s  %s\n' "$DREAMCAST_TOOLCHAIN_SHA256" "$toolchain_archive" |
  sha256sum --check --status

if [ ! -x "$toolchain_dir/sh-elf/bin/sh-elf-gcc" ] ||
  [ ! -s "$toolchain_dir/kos/environ.sh" ]; then
  tar -xzf "$toolchain_archive" -C "$toolchain_dir"
fi

test -x "$toolchain_dir/sh-elf/bin/sh-elf-gcc"
test -s "$toolchain_dir/kos/environ.sh"

tcp_patch="$app_dir/patches/kos-tcp-receive-window.patch"
tcp_patch_hash=$(sha256sum "$tcp_patch" | awk '{print $1}')
tcp_patch_stamp="$toolchain_dir/kos/.multiplex-tcp-receive-window"
installed_patch_hash=
if [ -f "$tcp_patch_stamp" ]; then
  installed_patch_hash=$(sed -n '1p' "$tcp_patch_stamp")
fi
if [ "$installed_patch_hash" != "$tcp_patch_hash" ]; then
  if patch --batch --dry-run --silent -d "$toolchain_dir/kos" -p1 \
    <"$tcp_patch"; then
    patch --batch --silent -d "$toolchain_dir/kos" -p1 <"$tcp_patch"
  elif ! patch --batch --dry-run --silent --reverse -d "$toolchain_dir/kos" -p1 \
    <"$tcp_patch"; then
    echo "The Dreamcast KOS TCP patch does not apply to the pinned toolchain." >&2
    exit 1
  fi
  bash -c '
    set -e
    source "$1/environ.sh"
    make --no-print-directory -C "$1/kernel/net" net_tcp.o
    make --no-print-directory -C "$1/kernel"
  ' _ "$toolchain_dir/kos"
  printf '%s\n' "$tcp_patch_hash" >"$tcp_patch_stamp"
fi
echo "Dreamcast $DREAMCAST_TOOLCHAIN_VERSION toolchain is ready."

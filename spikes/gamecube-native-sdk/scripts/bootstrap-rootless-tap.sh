#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

for command in git make cc; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to build the rootless TAP helper." >&2
    exit 1
  fi
done

passt_dir="$spike_dir/.passt"
passt_url=https://passt.top/passt

if [ ! -d "$passt_dir/.git" ]; then
  if [ -e "$passt_dir" ]; then
    echo "$passt_dir exists but is not a passt git checkout" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$passt_url" "$passt_dir"
  git -C "$passt_dir" checkout --detach "$PASST_COMMIT"
fi

actual_commit=$(git -C "$passt_dir" rev-parse HEAD)
if [ "$actual_commit" != "$PASST_COMMIT" ]; then
  echo "passt checkout is at $actual_commit; expected $PASST_COMMIT" >&2
  exit 1
fi

if [ ! -x "$passt_dir/passt" ]; then
  make -C "$passt_dir" pasta
fi

test -x "$passt_dir/pasta"
echo "Rootless TAP helper passt $PASST_COMMIT is ready."

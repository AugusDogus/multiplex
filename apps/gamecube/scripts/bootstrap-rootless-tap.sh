#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

for command in git make cc; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to build the rootless TAP helper." >&2
    exit 1
  fi
done

passt_dir="$app_dir/.passt"
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

passt_patch="$app_dir/patches/passt-handle-data-on-handshake-ack.patch"
passt_small_window_patch="$app_dir/patches/passt-ack-small-window-guests-immediately.patch"
passt_small_window_retransmit_patch="$app_dir/patches/passt-avoid-spurious-small-window-retransmit.patch"
passt_small_window_pull_patch="$app_dir/patches/passt-pull-small-window-on-ack.patch"
passt_small_window_send_patch="$app_dir/patches/passt-floor-small-window-guest-send.patch"
for patch_file in "$passt_patch" "$passt_small_window_patch" "$passt_small_window_retransmit_patch" "$passt_small_window_pull_patch" "$passt_small_window_send_patch"; do
  if git -C "$passt_dir" apply --unidiff-zero --reverse --check "$patch_file" >/dev/null 2>&1; then
    :
  elif git -C "$passt_dir" apply --unidiff-zero --check "$patch_file"; then
    git -C "$passt_dir" apply --unidiff-zero "$patch_file"
  else
    echo "passt patch does not apply cleanly: $patch_file" >&2
    exit 1
  fi
done

passt_input="$PASST_COMMIT $(cksum "$passt_patch") $(cksum "$passt_small_window_patch") $(cksum "$passt_small_window_retransmit_patch") $(cksum "$passt_small_window_pull_patch") $(cksum "$passt_small_window_send_patch")"
passt_stamp="$passt_dir/.multiplex-build-input"
if [ ! -x "$passt_dir/pasta" ] ||
  [ ! -f "$passt_stamp" ] ||
  [ "$(sed -n '1p' "$passt_stamp")" != "$passt_input" ]; then
  make -C "$passt_dir" clean
  make -C "$passt_dir" pasta
  printf '%s\n' "$passt_input" >"$passt_stamp"
fi

test -x "$passt_dir/pasta"
echo "Rootless TAP helper passt $PASST_COMMIT is ready."

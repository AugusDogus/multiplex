#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

python3 "$script_dir/test-plex-gateway.py"
python3 "$script_dir/test-multiplex-pair.py"
python3 "$script_dir/test-plex-pair.py"
python3 "$script_dir/test-provision-tls-entropy.py"

for test_script in \
  test-auth-record.sh \
  test-catalog-cache.sh \
  test-memory-card-presentation.sh \
  test-tls-ca.sh \
  test-entropy-seed.sh \
  test-plex-server-directory.sh \
  test-plex-catalog.sh \
  test-hls-playlist.sh \
  test-mpeg-ts-parser.sh \
  test-audio-buffer-queue.sh \
  test-trpc-rooms.sh \
  test-reference-frame.sh \
  test-gui-navigation.sh; do
  sh "$script_dir/$test_script"
done

cd "$app_dir"

echo "Checking the TypeScript core and Native markup on the null platform..."
zig build test -Dplatform=null

echo "Compiling the generated core for the GameCube's PowerPC 750..."
zig build gamecube-core

test -s zig-out/lib/libmultiplex-gamecube-core.a
file zig-out/lib/libmultiplex-gamecube-core.a

echo "GameCube portable tests passed."

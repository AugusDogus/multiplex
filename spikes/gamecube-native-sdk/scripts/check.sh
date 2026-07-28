#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

sh "$script_dir/bootstrap.sh"

python3 "$script_dir/test-plex-gateway.py"
python3 "$script_dir/test-multiplex-pair.py"
python3 "$script_dir/test-plex-pair.py"
sh "$script_dir/test-auth-record.sh"
sh "$script_dir/test-plex-server-directory.sh"
sh "$script_dir/test-plex-catalog.sh"

cd "$spike_dir"

echo "Checking the TypeScript core and Native markup on the null platform..."
zig build test -Dplatform=null

echo "Compiling the generated core for the GameCube's PowerPC 750..."
zig build gamecube-core

test -s zig-out/lib/libmultiplex-gamecube-core.a
file zig-out/lib/libmultiplex-gamecube-core.a

echo "GameCube Native SDK spike checks passed."

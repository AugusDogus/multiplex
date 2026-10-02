#!/bin/sh
set -eu

app_dir=/workspace/apps/ps2
build_dir="$app_dir/build-network-probe"
output="$app_dir/multiplex-ps2-network-probe.elf"
compiler=mips64r5900el-ps2-elf-gcc
readelf=mips64r5900el-ps2-elf-readelf

export PATH="$PS2DEV/ee/bin:$PS2DEV/iop/bin:$PS2DEV/dvp/bin:$PS2SDK/bin:$PATH"

mkdir -p "$build_dir"
bin2c "$PS2SDK/iop/irx/ps2dev9.irx" "$build_dir/dev9_irx.c" DEV9_irx
bin2c "$PS2SDK/iop/irx/netman.irx" "$build_dir/netman_irx.c" NETMAN_irx
bin2c "$PS2SDK/iop/irx/smap.irx" "$build_dir/smap_irx.c" SMAP_irx

compile() {
  source=$1
  object=$2
  $compiler -std=c11 -D_EE -G0 -O2 -Wall -Wextra -Werror \
    -I"$build_dir" -I"$PS2SDK/ee/include" -I"$PS2SDK/common/include" \
    -c "$source" -o "$object"
}

compile "$app_dir/src/network_probe.c" "$build_dir/network_probe.o"
compile "$build_dir/dev9_irx.c" "$build_dir/dev9_irx.o"
compile "$build_dir/netman_irx.c" "$build_dir/netman_irx.o"
compile "$build_dir/smap_irx.c" "$build_dir/smap_irx.o"

$compiler -T"$PS2SDK/ee/startup/linkfile" -O2 \
  "$build_dir/network_probe.o" "$build_dir/dev9_irx.o" \
  "$build_dir/netman_irx.o" "$build_dir/smap_irx.o" \
  -L"$PS2SDK/ee/lib" -Wl,-zmax-page-size=128 \
  -lnetman -lps2ip -ldebug -lpatches -o "$output"

$readelf -h "$output" | grep -q 'Class:.*ELF32'
$readelf -h "$output" | grep -q 'Flags:.*abi2, 5900, mips3'

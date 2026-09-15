#!/bin/sh
set -eu

app_dir=/workspace/apps/ps2
ui_dir=/workspace/packages/console-ui
build_dir="$app_dir/build-scene-client"
output="$app_dir/multiplex-ps2-scene-client.elf"
compiler=mips64r5900el-ps2-elf-gcc
readelf=mips64r5900el-ps2-elf-readelf

export PATH="$PS2DEV/ee/bin:$PS2DEV/iop/bin:$PS2DEV/dvp/bin:$PS2SDK/bin:$PATH"

mkdir -p "$build_dir"
bin2c "$PS2SDK/iop/irx/ps2dev9.irx" "$build_dir/dev9_irx.c" DEV9_irx
bin2c "$PS2SDK/iop/irx/netman.irx" "$build_dir/netman_irx.c" NETMAN_irx
bin2c "$PS2SDK/iop/irx/smap.irx" "$build_dir/smap_irx.c" SMAP_irx
bin2c "$PS2SDK/iop/irx/audsrv.irx" "$build_dir/audsrv_irx.c" AUDSRV_irx

compile() {
  source=$1
  object=$2
  $compiler -std=c11 -D_EE -G0 -O2 -Wall -Wextra -Werror \
    -I"$build_dir" -I"$ui_dir/include" \
    -I"$PS2SDK/ee/include" -I"$PS2SDK/common/include" -I"$GSKIT/include" \
    -c "$source" -o "$object"
}

compile "$app_dir/src/scene_client.c" "$build_dir/scene_client.o"
compile "$app_dir/src/media_player.c" "$build_dir/media_player.o"
compile "$ui_dir/scene/console_scene.c" "$build_dir/console_scene.o"
compile "$build_dir/dev9_irx.c" "$build_dir/dev9_irx.o"
compile "$build_dir/netman_irx.c" "$build_dir/netman_irx.o"
compile "$build_dir/smap_irx.c" "$build_dir/smap_irx.o"
compile "$build_dir/audsrv_irx.c" "$build_dir/audsrv_irx.o"

$compiler -T"$PS2SDK/ee/startup/linkfile" -O2 \
  "$build_dir/scene_client.o" "$build_dir/media_player.o" \
  "$build_dir/console_scene.o" \
  "$build_dir/dev9_irx.o" "$build_dir/netman_irx.o" \
  "$build_dir/smap_irx.o" "$build_dir/audsrv_irx.o" \
  -L"$PS2SDK/ee/lib" -L"$GSKIT/lib" -Wl,-zmax-page-size=128 \
  -lgskit_toolkit -lgskit -ldmakit -lmpeg -laudsrv -lpad -lnetman -lps2ip \
  -ldebug -lpatches -lpacket -ldraw -lgraph -ldma -lm \
  -o "$output"

$readelf -h "$output" | grep -q 'Class:.*ELF32'
$readelf -h "$output" | grep -q 'Flags:.*abi2, 5900, mips3'

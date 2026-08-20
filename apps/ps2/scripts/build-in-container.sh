#!/bin/sh
set -eu

app_dir=/workspace/apps/ps2
build_dir="$app_dir/build-native-reference"
frame="$build_dir/native-reference.rgba"
output="$app_dir/multiplex-ps2-native-reference.elf"
compiler=mips64r5900el-ps2-elf-gcc
readelf=mips64r5900el-ps2-elf-readelf

export PATH="$PS2DEV/ee/bin:$PS2DEV/iop/bin:$PS2DEV/dvp/bin:$PS2SDK/bin:$PATH"

if [ "$(wc -c <"$frame")" -ne 1228800 ]; then
  echo "The PlayStation 2 reference frame is not 640x480 RGBA." >&2
  exit 1
fi

mkdir -p "$build_dir"
rm -f "$build_dir/main.o" "$build_dir/native-reference.c" \
  "$build_dir/native-reference.o" "$output"
bin2c "$frame" "$build_dir/native-reference.c" native_reference

$compiler -std=c11 -D_EE -G0 -O2 -Wall -Wextra -Werror \
  -I"$PS2SDK/ee/include" -I"$PS2SDK/common/include" -I"$GSKIT/include" \
  -c "$app_dir/src/main.c" -o "$build_dir/main.o"
$compiler -std=c11 -D_EE -G0 -O2 -Wall -Wextra -Werror \
  -I"$PS2SDK/ee/include" -I"$PS2SDK/common/include" -I"$GSKIT/include" \
  -c "$build_dir/native-reference.c" \
  -o "$build_dir/native-reference.o"
$compiler -T"$PS2SDK/ee/startup/linkfile" -O2 \
  "$build_dir/main.o" "$build_dir/native-reference.o" \
  -L"$PS2SDK/ee/lib" -L"$GSKIT/lib" -Wl,-zmax-page-size=128 \
  -lgskit -ldmakit -lm -o "$output"

$readelf -h "$output" | grep -q 'Class:.*ELF32'
$readelf -h "$output" | grep -q 'Flags:.*abi2, 5900, mips3'

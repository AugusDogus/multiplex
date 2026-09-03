#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
codec_dir="$app_dir/.mplayer-ce-libogc2"
ffmpeg_dir="$codec_dir/mplayer/ffmpeg"
nxdk_dir="$app_dir/.nxdk"
patch_file="$app_dir/patches/ffmpeg-clang-inline-asm.patch"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if [ ! -d "$nxdk_dir/.git" ]; then
  echo "Pinned nxdk checkout is missing. Run bun run xbox:bootstrap." >&2
  exit 1
fi

if [ ! -d "$codec_dir/.git" ]; then
  if [ -e "$codec_dir" ]; then
    echo "$codec_dir exists but is not an MPlayer CE git checkout." >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout \
    https://github.com/SuperrSonic/mplayer-ce-libogc2.git "$codec_dir"
  git -C "$codec_dir" checkout --detach "$MPLAYER_CE_LIBOGC2_COMMIT"
fi

actual_commit=$(git -C "$codec_dir" rev-parse HEAD)
if [ "$actual_commit" != "$MPLAYER_CE_LIBOGC2_COMMIT" ]; then
  echo "MPlayer CE is at $actual_commit; expected $MPLAYER_CE_LIBOGC2_COMMIT." >&2
  exit 1
fi

if git -C "$codec_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
  :
elif git -C "$codec_dir" apply --check "$patch_file"; then
  git -C "$codec_dir" apply "$patch_file"
else
  echo "FFmpeg Xbox patch does not apply cleanly: $patch_file" >&2
  exit 1
fi

build_input="$MPLAYER_CE_LIBOGC2_COMMIT $(cksum "$patch_file") $(git -C "$nxdk_dir" rev-parse HEAD)"
build_stamp="$codec_dir/.multiplex-xbox-build-input"
avcodec_library="$ffmpeg_dir/libavcodec/libavcodec.a"
avutil_library="$ffmpeg_dir/libavutil/libavutil.a"
if [ -s "$avcodec_library" ] && [ -s "$avutil_library" ] &&
  [ -f "$build_stamp" ] && [ "$(sed -n '1p' "$build_stamp")" = "$build_input" ]; then
  echo "Pinned Xbox FFmpeg decoder is ready."
  exit 0
fi

export NXDK_DIR="$nxdk_dir"
PATH="$nxdk_dir/bin:$PATH"
export PATH

chmod +x "$ffmpeg_dir/configure" "$ffmpeg_dir/version.sh"
(
  cd "$ffmpeg_dir"
  bash ./configure \
    --enable-cross-compile \
    --target-os=freedos \
    --arch=x86 \
    --cpu=pentium3 \
    --cc=nxdk-cc \
    --ar=llvm-ar \
    --nm=llvm-nm \
    --disable-amd3dnow \
    --disable-amd3dnowext \
    --disable-ssse3 \
    --disable-avx \
    --enable-memalign-hack \
    --disable-doc \
    --disable-ffmpeg \
    --disable-ffplay \
    --disable-ffprobe \
    --disable-ffserver \
    --disable-avdevice \
    --disable-avformat \
    --disable-swscale \
    --disable-avfilter \
    --disable-network \
    --disable-everything \
    --enable-decoder=h264 \
    --enable-decoder=aac \
    --enable-decoder=mpeg2video \
    --enable-decoder=mp2 \
    --enable-decoder=mjpeg \
    --enable-parser=h264 \
    --enable-parser=aac \
    --enable-parser=mpegvideo \
    --extra-cflags='-std=gnu99 -O2 -DNXDK -DHAVE_PAIRED=0 -U_WIN32' \
    --extra-ldflags='-Wl,-entry:main'

  make -j2 libavcodec/libavcodec.a

  avutil_objects='libavutil/adler32.o libavutil/aes.o libavutil/audioconvert.o libavutil/avstring.o libavutil/base64.o libavutil/cpu.o libavutil/crc.o libavutil/des.o libavutil/error.o libavutil/eval.o libavutil/fifo.o libavutil/imgutils.o libavutil/intfloat_readwrite.o libavutil/inverse.o libavutil/lfg.o libavutil/lls.o libavutil/log.o libavutil/lzo.o libavutil/mathematics.o libavutil/md5.o libavutil/mem.o libavutil/opt.o libavutil/pixdesc.o libavutil/rational.o libavutil/rc4.o libavutil/samplefmt.o libavutil/sha.o libavutil/tree.o libavutil/utils.o libavutil/x86/cpu.o'
  # File mapping, color parsing, and random seeding are not part of the
  # decoder surface. They require POSIX APIs that nxdk intentionally omits.
  make -j2 $avutil_objects
  llvm-ar rcs "$avutil_library" $avutil_objects
)

printf '%s\n' "$build_input" >"$build_stamp"
echo "Pinned Xbox FFmpeg decoder is ready."

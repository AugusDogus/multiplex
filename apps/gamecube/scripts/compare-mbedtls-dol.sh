#!/bin/sh
set -eu
umask 077
LC_ALL=C
export LC_ALL

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 BASELINE_STAGE CANDIDATE_STAGE" >&2
  exit 2
fi

baseline_stage=$1
candidate_stage=$2
libogc_stage=${GAMECUBE_LIBOGC2_STAGE_DIR:-$app_dir/.libogc2-stage}
mplayer_root=${GAMECUBE_MPLAYER_ROOT:-$app_dir/.mplayer-ce-libogc2/mplayer}
core_library=${GAMECUBE_CORE_LIBRARY:-$app_dir/zig-out/lib/libmultiplex-gamecube-core.a}
source_dir=${GAMECUBE_MBEDTLS_SOURCE_DIR:-$app_dir/.mbedtls}
config_file="$app_dir/host-reference-gx/mbedtls-gamecube-config.h"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required to compare the Mbed TLS DOLs." >&2
    exit 1
  fi
}

require_file() {
  if [ ! -s "$1" ]; then
    echo "Missing $1. Bootstrap the pinned GameCube dependencies and build the core archive first." >&2
    exit 1
  fi
}

require_directory() {
  if [ ! -d "$1" ]; then
    echo "Missing directory $1. Bootstrap the pinned GameCube dependencies first." >&2
    exit 1
  fi
}

require_stage() {
  stage=$1
  for relative_path in \
    .build-input \
    include/mbedtls/build_info.h \
    lib/libmbedtls.a \
    lib/libmbedx509.a \
    lib/libmbedcrypto.a; do
    require_file "$stage/$relative_path"
  done
}

for command_name in podman cmp awk cksum find git grep sed sha256sum sort wc; do
  require_command "$command_name"
done
require_stage "$baseline_stage"
require_stage "$candidate_stage"
require_file "$config_file"
require_file "$libogc_stage/opt/devkitpro/libogc2/gamecube_rules"
require_directory "$libogc_stage/opt/devkitpro/libogc2/gamecube/include"
require_file "$libogc_stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a"
require_file "$libogc_stage/opt/devkitpro/libogc2/gamecube/lib/libbba.a"
require_directory "$mplayer_root/ffmpeg"
require_file "$mplayer_root/ffmpeg/libavcodec/libavcodec.a"
require_file "$mplayer_root/ffmpeg/libavutil/libavutil.a"
require_file "$core_library"
require_file "$app_dir/generated/geist_atlas.h"
require_file "$app_dir/assets/multiplex-dvd-demo.mpg"
require_file "$app_dir/certs/mozilla-ca-bundle.pem"
if ! git -C "$source_dir" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Missing Mbed TLS source checkout at $source_dir. Run bun run gamecube:bootstrap or set GAMECUBE_MBEDTLS_SOURCE_DIR." >&2
  exit 1
fi

baseline_stage=$(CDPATH= cd -- "$baseline_stage" && pwd)
candidate_stage=$(CDPATH= cd -- "$candidate_stage" && pwd)
libogc_stage=$(CDPATH= cd -- "$libogc_stage" && pwd)
mplayer_root=$(CDPATH= cd -- "$mplayer_root" && pwd)
core_dir=$(CDPATH= cd -- "$(dirname -- "$core_library")" && pwd)
core_name=$(basename -- "$core_library")
baseline_input=$(sed -n '1p' "$baseline_stage/.build-input")
candidate_input=$(sed -n '1p' "$candidate_stage/.build-input")
baseline_stamp="$baseline_stage/.build-input"
candidate_stamp="$candidate_stage/.build-input"
parse_stamp() {
  stamp_file=$1
  parsed_file=$2
  awk '
    NR == 1 && NF >= 3 && length($1) == 40 &&
      $1 ~ /^[0-9a-f]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
      print $1, $2, $3
      valid = 1
      next
    }
    { valid = 0 }
    END { if (NR != 1 || !valid) exit 1 }
  ' "$stamp_file" >"$parsed_file"
}
baseline_parsed=$(mktemp)
candidate_parsed=$(mktemp)
if ! parse_stamp "$baseline_stamp" "$baseline_parsed" ||
  ! parse_stamp "$candidate_stamp" "$candidate_parsed"; then
  rm -f -- "$baseline_parsed" "$candidate_parsed"
  echo "Mbed TLS stage has a malformed build-input stamp." >&2
  exit 1
fi
read -r baseline_commit baseline_checksum baseline_config_length <"$baseline_parsed"
read -r candidate_commit candidate_checksum candidate_config_length <"$candidate_parsed"
rm -f -- "$baseline_parsed" "$candidate_parsed"
current_config=$(cksum "$config_file")
current_checksum=${current_config%% *}
current_remainder=${current_config#* }
current_config_length=${current_remainder%% *}
if [ "$baseline_checksum $baseline_config_length" != \
  "$current_checksum $current_config_length" ] ||
  [ "$candidate_checksum $candidate_config_length" != \
    "$current_checksum $current_config_length" ]; then
  echo "Both Mbed TLS stages must use the current GameCube config checksum $current_checksum $current_config_length." >&2
  exit 1
fi
if [ "$baseline_commit" = "$candidate_commit" ]; then
  echo "Mbed TLS baseline and candidate stages must use distinct commits." >&2
  exit 1
fi
if [ "$candidate_commit" != "$MBEDTLS_COMMIT" ]; then
  echo "Candidate stage commit $candidate_commit does not match PINS.env commit $MBEDTLS_COMMIT." >&2
  exit 1
fi

version_at_commit() {
  commit=$1
  label=$2
  if ! git -C "$source_dir" cat-file -e "$commit^{commit}" 2>/dev/null; then
    echo "Mbed TLS $label commit $commit is missing from $source_dir; fetch that commit or set GAMECUBE_MBEDTLS_SOURCE_DIR to a checkout containing both pins." >&2
    exit 1
  fi
  if ! build_info=$(git -C "$source_dir" show \
    "$commit:include/mbedtls/build_info.h"); then
    echo "Could not read build_info.h at Mbed TLS $label commit $commit." >&2
    exit 1
  fi
  version=$(printf '%s\n' "$build_info" |
    sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$version" ]; then
    echo "Mbed TLS $label commit $commit has no public version string." >&2
    exit 1
  fi
  printf '%s\n' "$version"
}
baseline_source_version=$(version_at_commit "$baseline_commit" baseline)
candidate_source_version=$(version_at_commit "$candidate_commit" candidate)
baseline_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$baseline_stage/include/mbedtls/build_info.h")
candidate_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$candidate_stage/include/mbedtls/build_info.h")
if [ "$baseline_version" != "$baseline_source_version" ]; then
  echo "Baseline stage version '$baseline_version' does not match commit $baseline_commit version '$baseline_source_version'." >&2
  exit 1
fi
if [ "$candidate_version" != "$candidate_source_version" ]; then
  echo "Candidate stage version '$candidate_version' does not match commit $candidate_commit version '$candidate_source_version'." >&2
  exit 1
fi

comparison_dir=
baseline_one_dir=
baseline_two_dir=
candidate_one_dir=
candidate_two_dir=
cleanup() {
  for temporary_path in \
    "$comparison_dir" \
    "$baseline_one_dir" \
    "$baseline_two_dir" \
    "$candidate_one_dir" \
    "$candidate_two_dir"; do
    if [ -n "$temporary_path" ]; then
      rm -rf -- "$temporary_path"
    fi
  done
}
trap cleanup EXIT INT TERM
comparison_dir=$(mktemp -d "$app_dir/.mbedtls-dol-comparison.XXXXXX")
baseline_one_dir=$(mktemp -d "$app_dir/.mbedtls-dol-baseline-1.XXXXXX")
baseline_two_dir=$(mktemp -d "$app_dir/.mbedtls-dol-baseline-2.XXXXXX")
candidate_one_dir=$(mktemp -d "$app_dir/.mbedtls-dol-candidate-1.XXXXXX")
candidate_two_dir=$(mktemp -d "$app_dir/.mbedtls-dol-candidate-2.XXXXXX")

core_symbols="$comparison_dir/core-undefined-symbols"
if ! podman run --rm \
  --volume "$core_dir:/core:ro" \
  "$DEVKITPPC_IMAGE" \
  sh -ec '
    export PATH=/opt/devkitpro/devkitPPC/bin:$PATH
    powerpc-eabi-nm -u "/core/$1"
  ' inspect-mbedtls-core "$core_name" >"$core_symbols"; then
  echo "powerpc-eabi-nm could not inspect $core_library." >&2
  exit 1
fi
if grep -Eq 'mbedtls_|psa_' "$core_symbols"; then
  echo "Core archive references Mbed TLS or PSA; the dependency-only DOL comparison is invalid." >&2
  exit 1
fi

mkdir -p "$comparison_dir/common"
sh "$script_dir/generate-media-source-header.sh" \
  "$comparison_dir/common/media-source.h"
sh "$script_dir/generate-tls-ca-header.sh" \
  "$comparison_dir/common/tls-ca.h"

sha256_file() {
  hash_label=$1
  hash_file=$2
  if ! hash_output=$(sha256sum "$hash_file"); then
    echo "Could not hash $hash_file." >&2
    exit 1
  fi
  hash_value=${hash_output%% *}
  if ! printf '%s\n' "$hash_value" |
    awk 'length($1) == 64 && $1 ~ /^[0-9a-f]+$/ { valid = 1 } END { if (!valid) exit 1 }'; then
    echo "sha256sum returned an unexpected result for $hash_file." >&2
    exit 1
  fi
  printf '%s SHA-256: %s\n' "$hash_label" "$hash_value"
}

write_manifest() {
  manifest_root=$1
  manifest_list=$2
  manifest_output=$3
  (
    cd "$manifest_root"
    while IFS= read -r relative_path; do
      sha256sum "$relative_path"
    done <"$manifest_list"
  ) >"$manifest_output"
  require_file "$manifest_output"
}

endpoint_inputs="$comparison_dir/endpoint-inputs"
{
  printf 'GAMECUBE_MEDIA_URL=%s\n' "${GAMECUBE_MEDIA_URL:-}"
  printf 'GAMECUBE_GATEWAY_URL=%s\n' "${GAMECUBE_GATEWAY_URL:-}"
  printf 'MULTIPLEX_BASE_URL=%s\n' "${MULTIPLEX_BASE_URL:-}"
  printf 'GAMECUBE_PLEX_BASE_URL=%s\n' "${GAMECUBE_PLEX_BASE_URL:-}"
  printf 'GAMECUBE_PLEX_VIDEO_RESOLUTION=%s\n' "${GAMECUBE_PLEX_VIDEO_RESOLUTION:-480x270}"
  printf 'GAMECUBE_PLEX_MAX_VIDEO_BITRATE=%s\n' "${GAMECUBE_PLEX_MAX_VIDEO_BITRATE:-700}"
  printf 'GAMECUBE_PLEX_START_OFFSET_MS=%s\n' "${GAMECUBE_PLEX_START_OFFSET_MS:-0}"
  printf 'GAMECUBE_MEDIA_VIDEO_BYTES=%s\n' "${GAMECUBE_MEDIA_VIDEO_BYTES:-0}"
  printf 'GAMECUBE_MEDIA_AUDIO_BYTES=%s\n' "${GAMECUBE_MEDIA_AUDIO_BYTES:-0}"
  printf 'GAMECUBE_MEDIA_VIDEO_PACKETS=%s\n' "${GAMECUBE_MEDIA_VIDEO_PACKETS:-0}"
  printf 'GAMECUBE_MEDIA_AUDIO_PACKETS=%s\n' "${GAMECUBE_MEDIA_AUDIO_PACKETS:-0}"
  printf 'GAMECUBE_MEDIA_VIDEO_PTS90K=%s\n' "${GAMECUBE_MEDIA_VIDEO_PTS90K:--1}"
  printf 'GAMECUBE_MEDIA_AUDIO_PTS90K=%s\n' "${GAMECUBE_MEDIA_AUDIO_PTS90K:--1}"
  printf 'MULTIPLEX_EMULATOR_HOST_IP=%s\n' "${MULTIPLEX_EMULATOR_HOST_IP:-}"
} >"$endpoint_inputs"

application_manifest="$comparison_dir/application-inputs.sha256"
(
  cd "$app_dir"
  {
    printf '%s\n' Makefile.reference.gamecube
    find host host-reference host-reference-gx -type f \
      \( -name '*.c' -o -name '*.h' \)
  } | sort -u | while IFS= read -r relative_path; do
    sha256sum "$relative_path"
  done
) >"$application_manifest"

libogc_root="$libogc_stage/opt/devkitpro/libogc2"
libogc_input_list="$comparison_dir/libogc-inputs.list"
{
  printf '%s\n' gamecube_rules
  (
    cd "$libogc_root"
    find gamecube/include -type f
  )
} | sort -u >"$libogc_input_list"
libogc_manifest="$comparison_dir/libogc-inputs.sha256"
write_manifest "$libogc_root" "$libogc_input_list" "$libogc_manifest"

ffmpeg_input_list="$comparison_dir/ffmpeg-headers.list"
(
  cd "$mplayer_root"
  find ffmpeg -type f -name '*.h' | sort -u
) >"$ffmpeg_input_list"
ffmpeg_manifest="$comparison_dir/ffmpeg-headers.sha256"
write_manifest "$mplayer_root" "$ffmpeg_input_list" "$ffmpeg_manifest"

baseline_header_list="$comparison_dir/baseline-mbedtls-headers.list"
(
  cd "$baseline_stage"
  find include -type f | sort -u
) >"$baseline_header_list"
baseline_header_manifest="$comparison_dir/baseline-mbedtls-headers.sha256"
write_manifest "$baseline_stage" "$baseline_header_list" \
  "$baseline_header_manifest"

candidate_header_list="$comparison_dir/candidate-mbedtls-headers.list"
(
  cd "$candidate_stage"
  find include -type f | sort -u
) >"$candidate_header_list"
candidate_header_manifest="$comparison_dir/candidate-mbedtls-headers.sha256"
write_manifest "$candidate_stage" "$candidate_header_list" \
  "$candidate_header_manifest"

printf 'devkitPPC image: %s\n' "$DEVKITPPC_IMAGE"
sha256_file 'core archive' "$core_library"
sha256_file 'libogc archive' "$libogc_stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a"
sha256_file 'libbba archive' "$libogc_stage/opt/devkitpro/libogc2/gamecube/lib/libbba.a"
sha256_file 'libavcodec archive' "$mplayer_root/ffmpeg/libavcodec/libavcodec.a"
sha256_file 'libavutil archive' "$mplayer_root/ffmpeg/libavutil/libavutil.a"
sha256_file 'libogc rules and headers manifest' "$libogc_manifest"
sha256_file 'FFmpeg headers manifest' "$ffmpeg_manifest"
sha256_file 'baseline libmbedtls archive' "$baseline_stage/lib/libmbedtls.a"
sha256_file 'baseline libmbedx509 archive' "$baseline_stage/lib/libmbedx509.a"
sha256_file 'baseline libmbedcrypto archive' "$baseline_stage/lib/libmbedcrypto.a"
sha256_file 'candidate libmbedtls archive' "$candidate_stage/lib/libmbedtls.a"
sha256_file 'candidate libmbedx509 archive' "$candidate_stage/lib/libmbedx509.a"
sha256_file 'candidate libmbedcrypto archive' "$candidate_stage/lib/libmbedcrypto.a"
sha256_file 'baseline Mbed TLS public headers manifest' \
  "$baseline_header_manifest"
sha256_file 'candidate Mbed TLS public headers manifest' \
  "$candidate_header_manifest"
sha256_file 'application source manifest' "$application_manifest"
sha256_file 'font atlas header' "$app_dir/generated/geist_atlas.h"
sha256_file 'DVD fixture' "$app_dir/assets/multiplex-dvd-demo.mpg"
sha256_file 'endpoint inputs' "$endpoint_inputs"
sha256_file 'generated endpoint header' "$comparison_dir/common/media-source.h"
sha256_file 'Mozilla CA input' "$app_dir/certs/mozilla-ca-bundle.pem"
supplemental_ca_file=${GAMECUBE_TLS_CA_FILE:-}
if [ -z "$supplemental_ca_file" ] && [ -n "${HOME:-}" ]; then
  case ${MULTIPLEX_BASE_URL:-} in
    https://*.localhost | https://*.localhost/*)
      if [ -s "$HOME/.portless/ca.pem" ]; then
        supplemental_ca_file="$HOME/.portless/ca.pem"
      fi
      ;;
  esac
fi
if [ -n "$supplemental_ca_file" ]; then
  require_file "$supplemental_ca_file"
  sha256_file 'supplemental CA input' "$supplemental_ca_file"
else
  printf 'supplemental CA input: none\n'
fi
sha256_file 'generated CA header' "$comparison_dir/common/tls-ca.h"

build_dol() {
  stage=$1
  build_dir=$2
  build_relative=${build_dir##*/}
  target_relative="$build_relative/artifact"
  build_log="$comparison_dir/$build_relative.log"

  mkdir -p "$build_dir"
  cp "$comparison_dir/common/media-source.h" "$build_dir/media-source.h"
  cp "$comparison_dir/common/tls-ca.h" "$build_dir/tls-ca.h"

  if ! podman run --rm \
    --volume "$app_dir:/workspace:Z" \
    --volume "$libogc_stage:/deps/libogc:ro" \
    --volume "$mplayer_root:/deps/mplayer:ro" \
    --volume "$core_dir:/deps/core:ro" \
    --volume "$stage:/deps/mbedtls:ro" \
    --workdir /workspace \
    "$DEVKITPPC_IMAGE" \
    sh -ec '
      export DEVKITPRO=/deps/libogc/opt/devkitpro
      export DEVKITPPC=/opt/devkitpro/devkitPPC
      export PATH=/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH
      make --no-print-directory -f Makefile.reference.gamecube \
        REFERENCE_VARIANT=dolphin \
        BUILD="$1" \
        TARGET="$2" \
        CORE_LIBRARY="/deps/core/$3" \
        MPLAYER_ROOT=/deps/mplayer \
        MBEDTLS_ROOT=/deps/mbedtls
    ' compare-mbedtls-dol "$build_relative" "$target_relative" "$core_name" \
    >"$build_log" 2>&1; then
    echo "Mbed TLS DOL build failed for $stage." >&2
    sed -n '1,200p' "$build_log" >&2
    exit 1
  fi

  require_file "$app_dir/$target_relative.elf"
  require_file "$app_dir/$target_relative.dol"
}

measure_elf() {
  label=$1
  artifact_dir=$2
  raw_output="$comparison_dir/$label.size-output"
  parsed_output="$comparison_dir/$label.size"
  if ! podman run --rm \
    --volume "$artifact_dir:/result:ro" \
    "$DEVKITPPC_IMAGE" \
    sh -ec '
      export PATH=/opt/devkitpro/devkitPPC/bin:$PATH
      powerpc-eabi-size /result/artifact.elf
    ' >"$raw_output"; then
    echo "powerpc-eabi-size failed for the $label comparison ELF." >&2
    exit 1
  fi
  if ! awk '
    $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ &&
      $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ {
      print $1, $2, $3, $4
      rows += 1
    }
    END { if (rows != 1) exit 1 }
  ' "$raw_output" >"$parsed_output"; then
    echo "powerpc-eabi-size returned an unexpected $label result." >&2
    exit 1
  fi
}

build_dol "$baseline_stage" "$baseline_one_dir"
build_dol "$baseline_stage" "$baseline_two_dir"
build_dol "$candidate_stage" "$candidate_one_dir"
build_dol "$candidate_stage" "$candidate_two_dir"

cmp "$baseline_one_dir/artifact.dol" "$baseline_two_dir/artifact.dol"
cmp "$candidate_one_dir/artifact.dol" "$candidate_two_dir/artifact.dol"

measure_elf baseline-1 "$baseline_one_dir"
measure_elf candidate-1 "$candidate_one_dir"
read -r baseline_text baseline_data baseline_bss baseline_total \
  <"$comparison_dir/baseline-1.size"
read -r candidate_text candidate_data candidate_bss candidate_total \
  <"$comparison_dir/candidate-1.size"
baseline_dol=$(wc -c <"$baseline_one_dir/artifact.dol")
candidate_dol=$(wc -c <"$candidate_one_dir/artifact.dol")

printf 'baseline stage: %s (Mbed TLS %s)\n' "$baseline_input" "$baseline_version"
printf 'candidate stage: %s (Mbed TLS %s)\n' "$candidate_input" "$candidate_version"
printf 'baseline DOL bytes: %s\n' "$baseline_dol"
printf 'candidate DOL bytes: %s\n' "$candidate_dol"
printf 'DOL byte delta: %+d\n' "$((candidate_dol - baseline_dol))"
printf 'baseline ELF text/data/bss/total: %s/%s/%s/%s\n' \
  "$baseline_text" "$baseline_data" "$baseline_bss" "$baseline_total"
printf 'candidate ELF text/data/bss/total: %s/%s/%s/%s\n' \
  "$candidate_text" "$candidate_data" "$candidate_bss" "$candidate_total"
printf 'ELF text/data/bss/total delta: %+d/%+d/%+d/%+d\n' \
  "$((candidate_text - baseline_text))" \
  "$((candidate_data - baseline_data))" \
  "$((candidate_bss - baseline_bss))" \
  "$((candidate_total - baseline_total))"
printf 'Each stage produced byte-identical DOLs across two isolated builds.\n'

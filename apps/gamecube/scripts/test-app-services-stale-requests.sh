#!/bin/sh
set -eu

set --
if [ "${MULTIPLEX_TEST_SANITIZERS:-0}" = 1 ]; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-app-services-content.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

printf '%s\n' \
  '#ifndef MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_GATEWAY_URL ""' \
  '#define MULTIPLEX_BASE_URL ""' \
  '#define MULTIPLEX_PLEX_BASE_URL ""' \
  '#define MULTIPLEX_PLEX_VIDEO_RESOLUTION "480x270"' \
  '#define MULTIPLEX_PLEX_MAX_VIDEO_BITRATE "700"' \
  '#define MULTIPLEX_PAIRING_ENABLED 1' \
  '#endif' >"$test_dir/media-source.h"

run_test() {
  test_binary="$test_dir/$1.test"
  test_source=$2
  shift 2
  "${CC:-cc}" -std=c11 -O2 -Wall -Wextra -Werror -pedantic \
    "$@" \
    -D_POSIX_C_SOURCE=200809L \
    -ffunction-sections -fdata-sections -Wl,--gc-sections \
    -I"$test_dir" \
    -I"$app_dir/host-reference-gx" \
    -I"$app_dir/host" \
    "$app_dir/host-reference-gx/app_services_request_slots.c" \
    "$app_dir/host-reference-gx/app_services_discovery.c" \
    "$app_dir/host-reference-gx/app_services_details.c" \
    "$app_dir/host-reference-gx/app_services_playback.c" \
    "$app_dir/host-reference-gx/app_services_playback_resolution.c" \
    "$app_dir/tests/app_services_content_test_support.c" \
    "$app_dir/tests/app_services_content_queue_test_support.c" \
    "$app_dir/tests/$test_source" \
    -o "$test_binary"
  "$test_binary"
}

run_test request-slots app_services_stale_request_test.c "$@"
run_test playback-command app_services_playback_command_test.c "$@"

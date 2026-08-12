#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

meson=${MESON:-meson}
clang_tidy=${CLANG_TIDY:-clang-tidy}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required. Run 'bun run gamecube:setup' from $repo_dir." >&2
    exit 1
  fi
}

setup_host_build() {
  build_dir=$1
  shift
  if [ -f "$build_dir/build.ninja" ]; then
    "$meson" setup --reconfigure --wrap-mode=nodownload \
      "$build_dir" "$repo_dir" "$@"
  elif [ -d "$build_dir/meson-private" ]; then
    "$meson" setup --wipe --wrap-mode=nodownload \
      "$build_dir" "$repo_dir" "$@"
  else
    "$meson" setup --wrap-mode=nodownload "$build_dir" "$repo_dir" "$@"
  fi
}

command_name=${1:-test}
case "$command_name" in
  setup | test | analyze)
    build_dir="$repo_dir/build/native"
    require_command "$meson"
    setup_host_build "$build_dir" -Dwarning_level=3 -Dwerror=true
    ;;
  sanitize)
    require_command "$meson"
    if [ -n "${GAMECUBE_SANITIZER_CC:-}" ]; then
      require_command "$GAMECUBE_SANITIZER_CC"
      sanitizer_cc=$GAMECUBE_SANITIZER_CC
    else
      require_command zig
      actual_zig_version=$(zig version)
      if [ "$actual_zig_version" != "$ZIG_VERSION" ]; then
        echo "Zig $ZIG_VERSION is required for sanitizer tests; found $actual_zig_version." >&2
        exit 1
      fi
      sanitizer_cc='zig cc'
    fi
    sanitizer_signature=$(
      printf '%s\n' "$sanitizer_cc"
      "$script_dir/sanitize-cc.sh" --version 2>&1
    )
    sanitizer_key=$(printf '%s' "$sanitizer_signature" | cksum | awk '{ print $1 }')
    build_dir="$repo_dir/build/native-sanitize-$sanitizer_key"
    CC="$sanitizer_cc" \
      CFLAGS='-Werror -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all' \
      LDFLAGS='-fsanitize=address,undefined -fno-sanitize-recover=all' \
      setup_host_build "$build_dir" \
      -Dwarning_level=3 -Dwerror=false -Db_sanitize=none \
      -Db_lundef=false
    ;;
  *)
    echo "usage: meson.sh [setup|test|sanitize|analyze]" >&2
    exit 2
    ;;
esac

case "$command_name" in
  setup)
    echo "Native compile database is ready at $build_dir/compile_commands.json."
    ;;
  test)
    "$meson" compile -C "$build_dir"
    "$meson" test -C "$build_dir" --suite gamecube-portable \
      --print-errorlogs
    ;;
  sanitize)
    export ASAN_OPTIONS="detect_leaks=1:halt_on_error=1:strict_string_checks=1"
    export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1"
    "$meson" compile -C "$build_dir"
    "$meson" test -C "$build_dir" --suite gamecube-portable \
      --print-errorlogs
    ;;
  analyze)
    require_command "$clang_tidy"
    "$meson" compile -C "$build_dir"
    "$clang_tidy" \
      --config-file="$repo_dir/.clang-tidy" \
      -p "$build_dir" \
      "$runtime_dir/src/auth_record.c" \
      "$app_dir/tests/auth_record_test.c"
    ;;
esac

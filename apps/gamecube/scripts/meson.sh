#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)

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
    build_dir="$repo_dir/build/native-sanitize"
    sanitizer_cc=${GAMECUBE_SANITIZER_CC:-clang}
    require_command "$meson"
    require_command "$sanitizer_cc"
    CC="$sanitizer_cc" setup_host_build "$build_dir" \
      -Dwarning_level=3 -Dwerror=true -Db_sanitize=address,undefined \
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
      "$app_dir/host-reference-gx/auth_record.c" \
      "$app_dir/tests/auth_record_test.c"
    ;;
esac

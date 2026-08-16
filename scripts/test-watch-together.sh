#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
mode=${1:-all}
base_url=${MULTIPLEX_BASE_URL:-https://multiplex.localhost}
server_pid=
web_auth_ready=0
tokens_ready=0
fixture_ready=0

case "$mode" in
  all | web | gamecube) ;;
  *)
    echo "Usage: bun run test:watch-together[:web|:gamecube]" >&2
    exit 2
    ;;
esac

resolve_env_file() {
  if [ -n "${WATCH_TOGETHER_ENV_FILE:-}" ]; then
    case "$WATCH_TOGETHER_ENV_FILE" in
      /*) candidate=$WATCH_TOGETHER_ENV_FILE ;;
      *) candidate="$repo_root/$WATCH_TOGETHER_ENV_FILE" ;;
    esac
    if [ ! -f "$candidate" ]; then
      echo "WATCH_TOGETHER_ENV_FILE does not name a readable file: $candidate" >&2
      exit 1
    fi
    printf '%s\n' "$candidate"
    return
  fi

  candidate="$repo_root/apps/web/.env"
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi

  common_git_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)
  candidate=$(dirname -- "$common_git_dir")/apps/web/.env
  if [ -f "$candidate" ]; then
    printf '%s\n' "$candidate"
    return
  fi

  echo "No Watch Together environment file was found." >&2
  echo "Create apps/web/.env or set WATCH_TOGETHER_ENV_FILE to its path." >&2
  exit 1
}

env_file=$(resolve_env_file)

run_bun() {
  bun --env-file="$env_file" "$@"
}

cleanup() {
  if [ -n "$server_pid" ]; then
    /bin/kill -TERM -- "-$server_pid" 2>/dev/null ||
      kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

probe_web() {
  curl --insecure --fail --silent --output /dev/null \
    --connect-timeout 1 --max-time 2 "$base_url/login"
}

wait_for_web() {
  attempts=0
  while [ "$attempts" -lt 120 ]; do
    if probe_web; then
      return
    fi
    if [ -n "$server_pid" ] && ! kill -0 "$server_pid" 2>/dev/null; then
      echo "Multiplex stopped while starting. See .watch-together-harness/app-server.log." >&2
      exit 1
    fi
    sleep 1
    attempts=$((attempts + 1))
  done
  echo "Multiplex did not become ready at $base_url within 120 seconds." >&2
  exit 1
}

ensure_web_server() {
  if probe_web; then
    echo "Reusing Multiplex at $base_url."
    return
  fi

  mkdir -p "$repo_root/.watch-together-harness"
  bunx portless prune >/dev/null
  echo "Starting Multiplex at $base_url."
  setsid env BETTER_AUTH_URL="$base_url" \
    bunx portless multiplex --force \
      bun --env-file="$env_file" run dev:app \
    >"$repo_root/.watch-together-harness/app-server.log" 2>&1 &
  server_pid=$!
  wait_for_web
}

ensure_web_auth() {
  ensure_web_server
  if [ "$web_auth_ready" -eq 1 ]; then
    return
  fi
  PLAYWRIGHT_BASE_URL="$base_url" PLAYWRIGHT_WEB_SERVER_URL="$base_url" \
    run_bun --filter @multiplex/web test:e2e:setup
  web_auth_ready=1
}

ensure_tokens() {
  if [ "$tokens_ready" -eq 1 ]; then
    return
  fi
  run_bun apps/watch-together-harness/scripts/authenticate.ts
  tokens_ready=1
}

ensure_fixture() {
  if [ "$fixture_ready" -eq 1 ]; then
    return
  fi
  ensure_tokens
  fixture_output=$(
    run_bun apps/watch-together-harness/scripts/resolve-gamecube-fixture.ts
  )
  fixture=$(printf '%s\n' "$fixture_output" |
    sed -n 's/^WATCH_TOGETHER_GAMECUBE_PLAN[[:space:]]//p' | tail -1)
  current_rating_key=$(printf '%s\n' "$fixture" | cut -f1)
  next_rating_key=$(printf '%s\n' "$fixture" | cut -f2)
  invitee_id=$(printf '%s\n' "$fixture" | cut -f3)
  case "$current_rating_key:$next_rating_key:$invitee_id" in
    *[!0-9:]* | :* | *: | *::* )
      echo "The Watch Together fixture resolver returned an invalid test plan." >&2
      exit 1
      ;;
  esac
  fixture_ready=1
}

run_web_suite() {
  ensure_web_server
  echo "Running production web Watch Together and Guest Link torture tests."
  PLAYWRIGHT_BASE_URL="$base_url" PLAYWRIGHT_WEB_SERVER_URL="$base_url" \
    run_bun --filter @multiplex/web test:e2e -- --project=watch-together
  web_auth_ready=1

  ensure_fixture
  echo "Running portable two-viewer direct-play harness."
  env WATCH_TOGETHER_HARNESS_RATING_KEY="$current_rating_key" \
    bun --env-file="$env_file" \
      --filter @multiplex/watch-together-harness test:live
  echo "Running portable two-viewer transcode harness."
  env WATCH_TOGETHER_HARNESS_RATING_KEY="$current_rating_key" \
    bun --env-file="$env_file" \
      --filter @multiplex/watch-together-harness test:live:transcode
}

run_gamecube_case() {
  label=$1
  artifact_dir="$repo_root/.watch-together-harness/artifacts/gamecube-$label"
  mkdir -p "$artifact_dir"

  case "$label" in
    lifecycle)
      skip_build=0
      start_offset_ms=0
      expect_autoplay_next=0
      autoplay_rating_key=
      stress_seeks=0
      ;;
    rotation)
      skip_build=1
      start_offset_ms=1000
      expect_autoplay_next=1
      autoplay_rating_key=$next_rating_key
      stress_seeks=1
      ;;
    *)
      echo "Unknown GameCube Watch Together case: $label" >&2
      exit 2
      ;;
  esac

  env \
    GAMECUBE_DIRECT_PLEX=1 \
    GAMECUBE_PLEX_WATCH_TOGETHER=1 \
    GAMECUBE_WATCH_TOGETHER_BROWSER_GUEST=1 \
    GAMECUBE_WATCH_TOGETHER_INVITEE_ID="$invitee_id" \
    GAMECUBE_PLEX_HOME_ROW_INDEX=0 \
    GAMECUBE_PLEX_HOME_ITEM_INDEX=0 \
    GAMECUBE_PLEX_RATING_KEY="$current_rating_key" \
    GAMECUBE_PLEX_KEEP_OPEN=0 \
    GAMECUBE_PLEX_WAIT_ARTWORK=0 \
    GAMECUBE_PLEX_SUSTAIN_SECONDS=3 \
    GAMECUBE_SKIP_BUILD="$skip_build" \
    GAMECUBE_PLEX_START_OFFSET_MS="$start_offset_ms" \
    GAMECUBE_PLEX_EXPECT_AUTOPLAY_NEXT="$expect_autoplay_next" \
    GAMECUBE_PLEX_AUTOPLAY_RATING_KEY="$autoplay_rating_key" \
    GAMECUBE_PLEX_STRESS_SEEKS="$stress_seeks" \
    GAMECUBE_DOLPHIN_CAPTURE_VIDEO=1 \
    GAMECUBE_DOLPHIN_WINDOW_CAPTURE_PATH="$artifact_dir/dolphin.mkv" \
    GAMECUBE_DOLPHIN_WINDOW_CAPTURE_FRAME_PATH="$artifact_dir/last-frame.png" \
    MULTIPLEX_BASE_URL="$base_url" \
    bun --env-file="$env_file" run gamecube:reference:plex
}

run_gamecube_suite() {
  ensure_web_auth
  ensure_fixture

  MULTIPLEX_BASE_URL="$base_url" \
    run_bun apps/watch-together-harness/scripts/provision-gamecube.ts

  echo "Running GameCube lifecycle, recovery, reconnect, and disband torture."
  run_gamecube_case lifecycle

  echo "Running GameCube rapid-seek and final-second rotation torture."
  run_gamecube_case rotation
}

cd "$repo_root"
case "$mode" in
  web) run_web_suite ;;
  gamecube) run_gamecube_suite ;;
  all)
    run_web_suite
    run_gamecube_suite
    ;;
esac

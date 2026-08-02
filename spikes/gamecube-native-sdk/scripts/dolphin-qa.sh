#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
user_dir="$spike_dir/.dolphin-user"
pid_file="$user_dir/dolphin.pid"
log="$user_dir/Logs/dolphin.log"
controller_pipe="$user_dir/Pipes/${MULTIPLEX_CONTROLLER_PIPE:-multiplex1}"
hotkey_pipe="$user_dir/Pipes/multiplex-hotkeys"
capture_dir="$user_dir/QACaptures"
repo_dir=$(CDPATH= cd -- "$spike_dir/../.." && pwd)
qa_service=multiplex-gamecube-dolphin-qa.service
web_service=multiplex-web-preview.service

usage() {
  cat <<'EOF'
Usage: dolphin-qa.sh COMMAND [ARGUMENTS]

Commands:
  launch                       Build and launch interactive linked Plex QA.
  stop                         Stop the interactive Dolphin QA service.
  status                       Show Dolphin, render, input, and FPS status.
  press BUTTON...              Pulse GameCube buttons without window focus.
  navigate DIRECTION           Move once with the MAIN analog stick.
  axis STICK X Y               Set MAIN or C stick axes from 0.0 to 1.0 (0.5 is neutral).
  screenshot [NAME]            Capture Dolphin's framebuffer without focus.
  wait-log PATTERN [SECONDS]   Wait for a new matching Dolphin log line.
  check                        Check memory, rendering, layout, and FPS logs.
  scenario navigation         Relaunch and capture catalog navigation baselines.
  scenario focus-gallery      Capture every focus target on catalog screens.
  scenario playback           Relaunch and verify details and player behavior.
  scenario player-gallery     Capture Start menu, player, and settings focus targets.
  scenario full-gallery       Capture every catalog and player focus target.

Buttons: a b x y z start l r up down left right
EOF
}

dolphin_pid() {
  if [ ! -s "$pid_file" ]; then
    return 1
  fi
  pid=$(sed -n '1p' "$pid_file")
  case "$pid" in
    '' | *[!0-9]*) return 1 ;;
  esac
  command_line=$(ps -p "$pid" -o args= 2>/dev/null || true)
  case "$command_line" in
    *dolphin-emu*"$user_dir"* | *run-dolphin-rootless-tap.sh*"$user_dir"*)
      printf '%s\n' "$pid"
      ;;
    *) return 1 ;;
  esac
}

require_dolphin() {
  if ! dolphin_pid >/dev/null; then
    echo "Dolphin is not running with the Multiplex user profile." >&2
    echo "Launch it with: bun run spike:gamecube:qa -- launch" >&2
    exit 1
  fi
}

normalize_button() {
  case "$1" in
    a | A) echo A ;;
    b | B) echo B ;;
    x | X) echo X ;;
    y | Y) echo Y ;;
    z | Z) echo Z ;;
    start | START) echo START ;;
    l | L) echo L ;;
    r | R) echo R ;;
    up | UP | D_UP) echo D_UP ;;
    down | DOWN | D_DOWN) echo D_DOWN ;;
    left | LEFT | D_LEFT) echo D_LEFT ;;
    right | RIGHT | D_RIGHT) echo D_RIGHT ;;
    *)
      echo "Unsupported GameCube button: $1" >&2
      exit 1
      ;;
  esac
}

send_pipe() {
  target_pipe=$1
  command=$2
  if [ ! -p "$target_pipe" ]; then
    echo "Missing Dolphin input pipe: $target_pipe" >&2
    exit 1
  fi
  if ! timeout 3 sh -c '
    exec 3>"$1"
    printf "%s\n" "$2" >&3
  ' sh "$target_pipe" "$command"; then
    echo "Dolphin did not open input pipe: $target_pipe" >&2
    exit 1
  fi
}

pulse_pipe() {
  target_pipe=$1
  token=$2
  if [ ! -p "$target_pipe" ]; then
    echo "Missing Dolphin input pipe: $target_pipe" >&2
    exit 1
  fi
  if ! timeout 3 sh -c '
    exec 3>"$1"
    printf "RELEASE %s\n" "$2" >&3
    sleep 0.05
    printf "PRESS %s\n" "$2" >&3
    sleep 0.5
    printf "RELEASE %s\n" "$2" >&3
  ' sh "$target_pipe" "$token"; then
    echo "Dolphin did not open input pipe: $target_pipe" >&2
    exit 1
  fi
}

release_axis() {
  if [ ! -p "$controller_pipe" ]; then
    echo "Missing Dolphin input pipe: $controller_pipe" >&2
    exit 1
  fi
  if ! timeout 3 sh -c '
    exec 3>"$1"
    remaining=20
    while [ "$remaining" -gt 0 ]; do
      printf "SET MAIN 0.5 0.5\n" >&3
      sleep 0.05
      remaining=$((remaining - 1))
    done
  ' sh "$controller_pipe"; then
    echo "Dolphin did not open input pipe: $controller_pipe" >&2
    exit 1
  fi
}

press_button() {
  button=$1
  initial=$(line_count 'controller buttons')
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    pulse_pipe "$controller_pipe" "$button"
    if [ "$(line_count 'controller buttons')" -gt "$initial" ]; then
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Dolphin did not sample GameCube button $button after 20 attempts." >&2
  exit 1
}

newest_screenshot() {
  find "$user_dir/ScreenShots" -type f -name '*.png' -printf '%T@ %p\n' 2>/dev/null |
    sort -nr |
    sed -n '1s/^[^ ]* //p'
}

png_is_complete() {
  [ -s "$1" ] &&
    [ "$(tail -c 12 "$1" | od -An -tx1 | tr -d ' \n')" = \
      0000000049454e44ae426082 ]
}

line_count() {
  if [ ! -s "$log" ]; then
    echo 0
    return
  fi
  count=$(rg -c "$1" "$log" 2>/dev/null || true)
  echo "${count:-0}"
}

wait_for_count() {
  pattern=$1
  initial=$2
  seconds=${3:-10}
  attempt=0
  max_attempts=$((seconds * 10))
  while [ "$attempt" -lt "$max_attempts" ]; do
    current=$(line_count "$pattern")
    if [ "$current" -gt "$initial" ]; then
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for a new Dolphin log line matching: $pattern" >&2
  exit 1
}

wait_for_player_controls_state() {
  expected=$1
  seconds=${2:-10}
  attempt=0
  max_attempts=$((seconds * 10))
  while [ "$attempt" -lt "$max_attempts" ]; do
    current=$(sed -n \
      's/.*player controls visible=\([01]\).*/\1/p' "$log" | tail -1)
    if [ "$current" = "$expected" ]; then
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for player controls visible=$expected." >&2
  exit 1
}

wait_for_stable_presentation() {
  seconds=${1:-90}
  attempt=0
  max_attempts=$((seconds * 10))
  while [ "$attempt" -lt "$max_attempts" ]; do
    fps_tenths=$(
      rg 'presentation=120 frames/' "$log" 2>/dev/null |
        tail -1 |
        sed -n 's/.*(\([0-9][0-9]*\)\.\([0-9]\) fps).*/\1\2/p'
    )
    if [ -n "$fps_tenths" ] &&
      [ "$fps_tenths" -ge 595 ] &&
      [ "$fps_tenths" -le 610 ]; then
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for stable 60 FPS Dolphin presentation." >&2
  exit 1
}

capture_screenshot() {
  name=${1:-}
  before=$(newest_screenshot || true)
  pulse_pipe "$hotkey_pipe" A
  attempt=0
  captured=
  while [ "$attempt" -lt 50 ]; do
    captured=$(newest_screenshot || true)
    if [ -n "$captured" ] && [ "$captured" != "$before" ]; then
      break
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if [ -z "$captured" ] || [ "$captured" = "$before" ]; then
    echo "Dolphin did not produce a screenshot within five seconds." >&2
    exit 1
  fi
  attempt=0
  while [ "$attempt" -lt 50 ] && ! png_is_complete "$captured"; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if ! png_is_complete "$captured"; then
    echo "Dolphin did not finish writing screenshot: $captured" >&2
    exit 1
  fi
  if [ -n "$name" ]; then
    case "$name" in
      *[!A-Za-z0-9._-]*)
        echo "Screenshot name may contain only letters, numbers, dots, underscores, and hyphens." >&2
        exit 1
        ;;
    esac
    mkdir -p "$capture_dir"
    destination="$capture_dir/$name.png"
    cp "$captured" "$destination"
    captured=$destination
  fi
  echo "$captured"
}

ensure_portless() {
  multiplex_url=${MULTIPLEX_BASE_URL:-https://multiplex.localhost}
  if curl -kfsS -o /dev/null "$multiplex_url/"; then
    return
  fi
  if systemctl --user --quiet is-active "$web_service"; then
    echo "Portless Multiplex is running but $multiplex_url is unavailable." >&2
    exit 1
  fi
  bun_bin=$(command -v bun)
  systemd-run --user --collect \
    --unit="$web_service" \
    --working-directory="$repo_dir" \
    --setenv="PATH=$PATH" \
    "$bun_bin" run dev >/dev/null
  attempt=0
  while [ "$attempt" -lt 120 ]; do
    if curl -kfsS -o /dev/null "$multiplex_url/"; then
      return
    fi
    if ! systemctl --user --quiet is-active "$web_service"; then
      echo "Portless Multiplex exited before becoming ready." >&2
      exit 1
    fi
    sleep 0.5
    attempt=$((attempt + 1))
  done
  echo "Portless Multiplex did not become ready within 60 seconds." >&2
  exit 1
}

launch() {
  for required_command in bun curl systemctl systemd-run; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
      echo "$required_command is required for interactive Dolphin QA." >&2
      exit 1
    fi
  done
  ensure_portless
  launch_attempt=1
  while [ "$launch_attempt" -le 3 ]; do
    if systemctl --user --quiet is-active "$qa_service"; then
      systemctl --user stop "$qa_service"
    fi
    systemctl --user reset-failed "$qa_service" 2>/dev/null || true
    systemd-run --user --collect \
      --unit="$qa_service" \
      --property=CPUSchedulingPolicy=other \
      --working-directory="$repo_dir" \
      --setenv="PATH=$PATH" \
      --setenv="PLEX_BASE_URL=${PLEX_BASE_URL:-}" \
      --setenv="MULTIPLEX_BASE_URL=${MULTIPLEX_BASE_URL:-https://multiplex.localhost}" \
      --setenv=GAMECUBE_DIRECT_PLEX=1 \
      --setenv=GAMECUBE_PLEX_INTERACTIVE=1 \
      --setenv=GAMECUBE_PLEX_KEEP_OPEN=1 \
      /bin/sh "$script_dir/run-dolphin-plex.sh" >/dev/null
    readiness_attempt=0
    while [ "$readiness_attempt" -lt 480 ]; do
      if dolphin_pid >/dev/null &&
        rg -q 'direct Plex posters decoded=[0-9]+/[0-9]+' "$log" 2>/dev/null; then
        echo "Interactive linked Plex QA is ready."
        status
        return
      fi
      if ! systemctl --user --quiet is-active "$qa_service"; then
        break
      fi
      sleep 0.5
      readiness_attempt=$((readiness_attempt + 1))
    done
    if [ "$launch_attempt" -lt 3 ]; then
      echo "Interactive Dolphin QA failed during startup; retrying ($launch_attempt/3)." >&2
    fi
    launch_attempt=$((launch_attempt + 1))
  done
  echo "Interactive Dolphin QA did not become ready after three attempts." >&2
  journalctl --user-unit "$qa_service" -n 80 --no-pager >&2 || true
  exit 1
}

press_and_wait() {
  button=$1
  initial=$(line_count 'signature=')
  press_button "$button"
  wait_for_count 'signature=' "$initial" 20
}

navigate_and_wait() {
  direction=$1
  case "$direction" in
    LEFT) stick_x=0; stick_y=0.5 ;;
    RIGHT) stick_x=1; stick_y=0.5 ;;
    UP) stick_x=0.5; stick_y=1 ;;
    DOWN) stick_x=0.5; stick_y=0 ;;
    *) echo "Unknown navigation direction: $direction" >&2; exit 1 ;;
  esac
  initial=$(line_count 'signature=')
  initial_input=$(line_count 'input action=')
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    send_pipe "$controller_pipe" "SET MAIN $stick_x $stick_y"
    if [ "$(line_count 'input action=')" -gt "$initial_input" ]; then
      break
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  release_axis
  if [ "$attempt" -eq 20 ]; then
    echo "Dolphin did not sample the $direction analog navigation pulse." >&2
    exit 1
  fi
  wait_for_count 'signature=' "$initial" 20
}

capture_focus_cycle() {
  screen=$1
  find "$capture_dir" -maxdepth 1 -type f \
    -name "focus-$screen-[0-9][0-9].png" -delete
  rm -f "$capture_dir/focus-$screen-contact-sheet.png"

  navigate_and_wait RIGHT
  focus_trace=$(rg 'input action=1 focus=[0-9]+ count=[0-9]+' "$log" | tail -1)
  focus_count=$(printf '%s\n' "$focus_trace" | sed -n \
    's/.*focus=[0-9][0-9]* count=\([0-9][0-9]*\).*/\1/p')
  previous_focus=$(printf '%s\n' "$focus_trace" | sed -n \
    's/.*focus=\([0-9][0-9]*\) count=[0-9][0-9]*.*/\1/p')
  case "$focus_count" in
    '' | *[!0-9]*)
      echo "Could not determine focus state for $screen." >&2
      exit 1
      ;;
  esac
  case "$previous_focus" in
    '' | *[!0-9]*)
      echo "Could not determine focus state for $screen." >&2
      exit 1
      ;;
  esac
  if [ "$focus_count" -eq 0 ]; then
    echo "$screen does not expose any focus targets." >&2
    exit 1
  fi

  current_focus=$(((previous_focus + 1) % focus_count))
  capture_screenshot "focus-$screen-$(printf '%02d' "$current_focus")" >/dev/null

  remaining=$((focus_count - 1))
  while [ "$remaining" -gt 0 ]; do
    navigate_and_wait RIGHT
    current_focus=$(sed -n \
      's/.*input action=1 focus=\([0-9][0-9]*\) count=[0-9][0-9]*.*/\1/p' \
      "$log" | tail -1)
    current_focus=$(((current_focus + 1) % focus_count))
    capture_screenshot "focus-$screen-$(printf '%02d' "$current_focus")" >/dev/null
    remaining=$((remaining - 1))
  done

  magick montage "$capture_dir"/focus-"$screen"-[0-9][0-9].png \
    -thumbnail 320x240 -tile 4x -geometry +6+22 \
    -background '#09090b' -fill '#fafafa' -pointsize 14 \
    -set label '%t' "$capture_dir/focus-$screen-contact-sheet.png"
  echo "$screen: captured $focus_count focus targets."
}

move_focus_to_index() {
  target_focus=$1
  focus_trace=$(rg 'input action=1 focus=[0-9]+ count=[0-9]+' "$log" | tail -1)
  traced_focus=$(printf '%s\n' "$focus_trace" | sed -n \
    's/.*focus=\([0-9][0-9]*\) count=[0-9][0-9]*.*/\1/p')
  focus_count=$(printf '%s\n' "$focus_trace" | sed -n \
    's/.*focus=[0-9][0-9]* count=\([0-9][0-9]*\).*/\1/p')
  case "$traced_focus:$focus_count:$target_focus" in
    *[!0-9:]* | :* | *::* | *:)
      echo "Could not determine the current focus state." >&2
      exit 1
      ;;
  esac
  if [ "$target_focus" -ge "$focus_count" ]; then
    echo "Focus target $target_focus is outside the $focus_count available targets." >&2
    exit 1
  fi

  # Directional input traces the focus before movement. This helper is called
  # after a rightward focus cycle, so advance once to recover the live index.
  current_focus=$(((traced_focus + 1) % focus_count))

  right_steps=$(((target_focus + focus_count - current_focus) % focus_count))
  left_steps=$(((current_focus + focus_count - target_focus) % focus_count))
  if [ "$right_steps" -le "$left_steps" ]; then
    direction=RIGHT
    steps=$right_steps
  else
    direction=LEFT
    steps=$left_steps
  fi
  while [ "$steps" -gt 0 ]; do
    navigate_and_wait "$direction"
    steps=$((steps - 1))
  done
}

navigation_scenario() {
  launch
  if ! rg -q 'direct Plex posters decoded=[0-9]+/[0-9]+' "$log"; then
    echo "The linked Plex catalog is not ready for navigation QA." >&2
    exit 1
  fi
  mkdir -p "$capture_dir"
  capture_screenshot navigation-home
  press_and_wait Z
  capture_screenshot navigation-search
  press_and_wait B
  press_and_wait Y
  capture_screenshot navigation-libraries
  press_and_wait B
  check
  echo "Navigation captures are ready in $capture_dir."
}

require_magick() {
  if ! command -v magick >/dev/null 2>&1; then
    echo "ImageMagick is required to build focus contact sheets." >&2
    exit 1
  fi
}

capture_catalog_focus_galleries() {
  capture_focus_cycle home
  press_and_wait Z
  capture_focus_cycle search
  press_and_wait B
  press_and_wait Y
  capture_focus_cycle libraries

  # One step after a complete cycle returns to the preferred first library.
  navigate_and_wait RIGHT
  browse_before=$(line_count 'browse-page ready')
  posters_before=$(line_count 'direct Plex posters decoded=')
  press_and_wait A
  wait_for_count 'browse-page ready' "$browse_before" 120
  wait_for_count 'direct Plex posters decoded=' "$posters_before" 120
  capture_focus_cycle browse

  press_and_wait B
  press_and_wait B
  details_before=$(line_count 'details-page ready')
  press_and_wait A
  wait_for_count 'details-page ready' "$details_before" 60
  capture_focus_cycle details
}

focus_gallery_scenario() {
  require_magick
  launch
  mkdir -p "$capture_dir"
  capture_catalog_focus_galleries
  check
  echo "Focus contact sheets are ready in $capture_dir."
}

playback_scenario() {
  launch
  details_before=$(line_count 'details-page ready')
  press_and_wait A
  wait_for_count 'details-page ready' "$details_before" 60
  capture_screenshot playback-details

  activation_before=$(line_count 'direct playback activated')
  ready_before=$(line_count 'direct playback ready')
  playing_before=$(line_count 'playback=playing')
  press_button A
  wait_for_count 'direct playback activated' "$activation_before" 120
  wait_for_count 'direct playback ready' "$ready_before" 120
  wait_for_count 'playback=playing' "$playing_before" 30
  capture_screenshot playback-controls-initial

  wait_for_player_controls_state 0 90
  capture_screenshot playback-fullscreen

  visible_before=$(line_count 'player controls visible=1')
  paused_before=$(line_count 'playback=paused')
  press_button A
  wait_for_count 'player controls visible=1' "$visible_before" 10
  if [ "$(line_count 'playback=paused')" -ne "$paused_before" ]; then
    echo "The first A press paused playback instead of revealing controls." >&2
    exit 1
  fi
  capture_screenshot playback-controls-revealed

  press_button A
  wait_for_count 'playback=paused' "$paused_before" 10
  capture_screenshot playback-paused

  resumed_before=$(line_count 'playback=playing')
  press_button A
  wait_for_count 'playback=playing' "$resumed_before" 10
  wait_for_stable_presentation
  check 1
  echo "Playback captures are ready in $capture_dir."
}

open_initial_details() {
  details_before=$(line_count 'details-page ready')
  details_signature_before=$(line_count 'signature=')
  press_button A
  wait_for_count 'details-page ready' "$details_before" 60
  wait_for_count 'signature=' "$details_signature_before" 60
}

capture_player_focus_galleries() {
  menu_signature_before=$(line_count 'signature=')
  press_button START
  wait_for_count 'signature=' "$menu_signature_before" 120
  capture_focus_cycle start-menu
  press_and_wait B

  activation_before=$(line_count 'direct playback activated')
  ready_before=$(line_count 'direct playback ready')
  playing_before=$(line_count 'playback=playing')
  press_button A
  wait_for_count 'direct playback activated' "$activation_before" 120
  wait_for_count 'direct playback ready' "$ready_before" 120
  wait_for_count 'playback=playing' "$playing_before" 30

  paused_before=$(line_count 'playback=paused')
  press_button A
  wait_for_count 'playback=paused' "$paused_before" 10
  capture_focus_cycle player

  player_focus_trace=$(rg 'input action=1 focus=[0-9]+ count=[0-9]+' "$log" | tail -1)
  player_focus_count=$(printf '%s\n' "$player_focus_trace" | sed -n \
    's/.*focus=[0-9][0-9]* count=\([0-9][0-9]*\).*/\1/p')
  case "$player_focus_count" in
    '' | *[!0-9]* | 0)
      echo "Could not determine the player focus target count." >&2
      exit 1
      ;;
  esac
  move_focus_to_index $((player_focus_count - 1))
  settings_signature_before=$(line_count 'signature=')
  press_button A
  wait_for_count 'signature=' "$settings_signature_before" 30
  capture_focus_cycle player-settings

  press_and_wait B
  resumed_before=$(line_count 'playback=playing')
  press_button A
  wait_for_count 'playback=playing' "$resumed_before" 10

  wait_for_stable_presentation
  check 1
}

player_gallery_scenario() {
  require_magick
  launch
  mkdir -p "$capture_dir"
  open_initial_details
  capture_player_focus_galleries
  echo "Player focus contact sheets are ready in $capture_dir."
}

full_gallery_scenario() {
  require_magick
  launch
  mkdir -p "$capture_dir"
  capture_catalog_focus_galleries
  capture_player_focus_galleries
  echo "Full focus contact sheets are ready in $capture_dir."
}

status() {
  if pid=$(dolphin_pid); then
    echo "Dolphin: running (PID $pid)"
  else
    echo "Dolphin: stopped"
  fi
  if [ ! -s "$log" ]; then
    echo "Log: unavailable"
    return
  fi
  latest_signature=$(rg 'REFERENCE GX: commands=.*signature=' "$log" | tail -1 || true)
  latest_input=$(rg 'REFERENCE GX: input action=' "$log" | tail -1 || true)
  latest_presentation=$(rg 'REFERENCE GX: presentation=120 frames/' "$log" | tail -1 || true)
  latest_decoder=$(rg 'REFERENCE GX: decoder=60 frames/' "$log" | tail -1 || true)
  [ -z "$latest_signature" ] || echo "Render: ${latest_signature#*REFERENCE GX: }"
  [ -z "$latest_input" ] || echo "Input: ${latest_input#*REFERENCE GX: }"
  [ -z "$latest_presentation" ] || echo "Display: ${latest_presentation#*REFERENCE GX: }"
  [ -z "$latest_decoder" ] || echo "Decoder: ${latest_decoder#*REFERENCE GX: }"
}

check() {
  require_presentation=${1:-0}
  sh "$script_dir/check-dolphin-log.sh"
  if rg -q 'layout-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
    echo "Native SDK layout audit found damaged geometry." >&2
    rg 'layout-audit findings=' "$log" | tail -5 >&2
    exit 1
  fi
  if rg -q 'poster-inset-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
    echo "Poster cards contain unintended image padding." >&2
    rg 'poster-inset-audit findings=' "$log" | tail -5 >&2
    exit 1
  fi
  stable_fps=$(
    rg 'presentation=120 frames/' "$log" |
      sed -n 's/.*(\([0-9][0-9]*\)\.\([0-9]\) fps).*/\1\2/p' |
      awk '$1 >= 595 && $1 <= 610 { value = $1 } END { if (value != "") print value }'
  )
  if [ -z "$stable_fps" ]; then
    if [ "$require_presentation" -eq 1 ]; then
      echo "Dolphin did not sustain a 59.5 to 61.0 FPS presentation sample." >&2
      exit 1
    fi
    echo "No stable playback FPS sample is available; video may be inactive or still starting."
    status
    return
  fi
  echo "Dolphin layout and poster inset audits are clean."
  echo "Dolphin presentation reached $((stable_fps / 10)).$((stable_fps % 10)) FPS."
  status
}

command=${1:-}
case "$command" in
  launch)
    launch
    ;;
  stop)
    if systemctl --user --quiet is-active "$qa_service"; then
      systemctl --user stop "$qa_service"
      echo "Interactive Dolphin QA stopped."
    else
      echo "Interactive Dolphin QA is already stopped."
    fi
    ;;
  status)
    status
    ;;
  press)
    shift
    if [ "$#" -eq 0 ]; then
      usage >&2
      exit 1
    fi
    require_dolphin
    for requested_button in "$@"; do
      button=$(normalize_button "$requested_button")
      press_button "$button"
    done
    ;;
  navigate)
    shift
    if [ "$#" -ne 1 ]; then
      usage >&2
      exit 1
    fi
    require_dolphin
    direction=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
    navigate_and_wait "$direction"
    ;;
  axis)
    shift
    if [ "$#" -ne 3 ]; then
      usage >&2
      exit 1
    fi
    require_dolphin
    stick=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
    case "$stick" in MAIN | C) ;; *) echo "Stick must be MAIN or C." >&2; exit 1 ;; esac
    send_pipe "$controller_pipe" "SET $stick $2 $3"
    ;;
  screenshot)
    shift
    if [ "$#" -gt 1 ]; then
      usage >&2
      exit 1
    fi
    require_dolphin
    capture_screenshot "${1:-}"
    ;;
  wait-log)
    shift
    if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
      usage >&2
      exit 1
    fi
    pattern=$1
    seconds=${2:-10}
    case "$seconds" in '' | *[!0-9]*) echo "Wait duration must be whole seconds." >&2; exit 1 ;; esac
    require_dolphin
    initial=$(line_count "$pattern")
    wait_for_count "$pattern" "$initial" "$seconds"
    rg "$pattern" "$log" | tail -1
    ;;
  check)
    check
    ;;
  scenario)
    shift
    case "${1:-}" in
      navigation) navigation_scenario ;;
      focus-gallery) focus_gallery_scenario ;;
      playback) playback_scenario ;;
      player-gallery) player_gallery_scenario ;;
      full-gallery) full_gallery_scenario ;;
      *) usage >&2; exit 1 ;;
    esac
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

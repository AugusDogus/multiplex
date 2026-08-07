#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
config_profile="$app_dir/dolphin/Dolphin.entropy-qa.ini"
logger_profile="$app_dir/dolphin/Logger.ini"
dol=${GAMECUBE_ENTROPY_QA_DOL:-"$app_dir/multiplex-gamecube-native-reference-dolphin.dol"}
qa_url=${GAMECUBE_ENTROPY_QA_URL:-https://example.com}
skip_build=${GAMECUBE_ENTROPY_QA_SKIP_BUILD:-0}
timeout_seconds=${GAMECUBE_ENTROPY_QA_TIMEOUT_SECONDS:-60}
artifact_base=${GAMECUBE_ENTROPY_QA_ARTIFACT_DIR:-"$app_dir/.dolphin-entropy-qa"}
dolphin_emu="$app_dir/.dolphin-source-2606/build/Binaries/dolphin-emu"
pasta_bin="$app_dir/.passt/pasta"
launcher_pid=
launcher_log=
pasta_pid=
dolphin_pid=
work_root=

wait_for_process_exit() {
  process_pid=$1
  attempt=0
  while kill -0 "$process_pid" 2>/dev/null && [ "$attempt" -lt 100 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  ! kill -0 "$process_pid" 2>/dev/null
}

find_child_by_name() {
  parent_pid=$1
  expected_name=$2
  matches=$(pgrep -P "$parent_pid" -x "$expected_name" 2>/dev/null || true)
  # Intentional field splitting rejects zero or multiple child PIDs.
  # shellcheck disable=SC2086
  set -- $matches
  [ "$#" -eq 1 ] || return 1
  printf '%s\n' "$1"
}

cleanup_launcher() {
  if [ -z "$launcher_pid" ] || ! kill -0 "$launcher_pid" 2>/dev/null; then
    launcher_pid=
    return
  fi
  kill -TERM "$launcher_pid" 2>/dev/null || true
  attempt=0
  while kill -0 "$launcher_pid" 2>/dev/null && [ "$attempt" -lt 100 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if kill -0 "$launcher_pid" 2>/dev/null; then
    kill -KILL "$launcher_pid" 2>/dev/null || true
  fi
  set +e
  wait "$launcher_pid" 2>/dev/null
  set -e
  launcher_pid=
}

shutdown_launcher() {
  label=$1
  session_pid=$launcher_pid
  pasta_pid=$(find_child_by_name "$launcher_pid" pasta) || {
    echo "Could not identify the rootless TAP process for $label." >&2
    return 1
  }
  dolphin_pid=$(find_child_by_name "$pasta_pid" dolphin-emu) || {
    echo "Could not identify the Dolphin process for $label." >&2
    return 1
  }

  if ! kill -TERM "$dolphin_pid" 2>/dev/null; then
    echo "Could not request Dolphin shutdown for $label." >&2
    return 1
  fi
  if ! wait_for_process_exit "$dolphin_pid"; then
    kill -KILL "$dolphin_pid" 2>/dev/null || true
    echo "Dolphin required SIGKILL during $label; refusing unclean QA evidence." >&2
    return 1
  fi
  if ! wait_for_process_exit "$pasta_pid"; then
    echo "The rootless TAP process did not exit after Dolphin shutdown for $label." >&2
    return 1
  fi

  set +e
  wait "$launcher_pid"
  launcher_status=$?
  set -e
  remaining_pids=$(pgrep -g "$session_pid" 2>/dev/null || true)
  if [ -n "$remaining_pids" ]; then
    # Intentional field splitting iterates over pgrep's newline-delimited PIDs.
    # shellcheck disable=SC2086
    for remaining_pid in $remaining_pids; do
      kill -TERM "$remaining_pid" 2>/dev/null || true
    done
    sleep 0.1
    # shellcheck disable=SC2086
    for remaining_pid in $remaining_pids; do
      kill -KILL "$remaining_pid" 2>/dev/null || true
    done
    echo "The Dolphin process group still has members after $label shutdown: $remaining_pids" >&2
    return 1
  fi
  if [ "$launcher_status" -ne 0 ]; then
    echo "The rootless TAP launcher exited with status $launcher_status for $label; expected 0." >&2
    return 1
  fi
  signal_count=$(rg -acF \
    'A signal was received. A second signal will force Dolphin to stop.' \
    "$launcher_log" || true)
  signal_count=${signal_count:-0}
  if [ "$signal_count" -ne 1 ]; then
    echo "$label logged $signal_count Dolphin shutdown signals; expected exactly one." >&2
    return 1
  fi

  {
    echo 'dolphin-signal=SIGTERM'
    echo "signal-handler-count=$signal_count"
    echo "tap-launcher-exit-status=$launcher_status"
    echo 'process-group-empty=yes'
  } >"$artifact_dir/$label-shutdown.txt"
  launcher_pid=
  pasta_pid=
  dolphin_pid=
}

cleanup() {
  cleanup_launcher
  if [ -n "$work_root" ]; then
    case "$work_root" in
      "${TMPDIR:-/tmp}"/multiplex-dolphin-entropy-qa.*)
        rm -rf -- "$work_root"
        ;;
      *)
        echo "Refusing to remove unexpected QA work path: $work_root" >&2
        ;;
    esac
  fi
}
trap cleanup EXIT HUP INT TERM

for command in pgrep rg setsid strings tshark; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for Dolphin entropy QA." >&2
    exit 1
  fi
done
case "$qa_url" in
  https://*) ;;
  *)
    echo "GAMECUBE_ENTROPY_QA_URL must use HTTPS." >&2
    exit 1
    ;;
esac
qa_host=${qa_url#https://}
qa_host=${qa_host%%/*}
qa_host=${qa_host%%:*}
if [ -z "$qa_host" ] || printf '%s' "$qa_host" | LC_ALL=C grep -q '[^A-Za-z0-9.-]'; then
  echo "Could not extract a safe HTTPS hostname from GAMECUBE_ENTROPY_QA_URL." >&2
  exit 1
fi
case "$skip_build" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_ENTROPY_QA_SKIP_BUILD must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$timeout_seconds" in
  '' | *[!0-9]* | 0)
    echo "GAMECUBE_ENTROPY_QA_TIMEOUT_SECONDS must be a positive integer." >&2
    exit 1
    ;;
esac

if [ "$skip_build" -eq 0 ]; then
  MULTIPLEX_BASE_URL="$qa_url" sh "$script_dir/build-native-reference-dol.sh"
fi
if [ ! -s "$dol" ]; then
  echo "Missing QA DOL at $dol; build it with an HTTPS MULTIPLEX_BASE_URL." >&2
  exit 1
fi
if ! strings "$dol" | grep -Fqx "$qa_url"; then
  echo "The QA DOL does not contain the expected HTTPS origin: $qa_url" >&2
  echo "Rebuild without GAMECUBE_ENTROPY_QA_SKIP_BUILD=1." >&2
  exit 1
fi
if [ ! -x "$dolphin_emu" ]; then
  echo "Missing the pinned patched Dolphin emulator at $dolphin_emu." >&2
  echo "Run bun run gamecube:dolphin:bootstrap first." >&2
  exit 1
fi
sh "$script_dir/bootstrap-rootless-tap.sh"
if [ ! -x "$pasta_bin" ]; then
  echo "The pinned rootless TAP helper was not built at $pasta_bin." >&2
  exit 1
fi

mkdir -p "$artifact_base"
artifact_dir=$(mktemp -d "$artifact_base/run.XXXXXX")
chmod 700 "$artifact_dir"
work_root=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-dolphin-entropy-qa.XXXXXX")
chmod 700 "$work_root"

create_profile() {
  profile=$1
  mkdir -p "$profile/Config" "$profile/GC/USA/Card A"
  cp "$config_profile" "$profile/Config/Dolphin.ini"
  cp "$logger_profile" "$profile/Config/Logger.ini"
}

newest_pcap() {
  profile=$1
  find "$profile/Dump/SSL" -type f -name '*.pcap' -printf '%T@ %p\n' \
    2>/dev/null | sort -nr | sed -n '1s/^[^ ]* //p'
}

boot_until() {
  profile=$1
  label=$2
  expected=$3
  log="$profile/Logs/dolphin.log"
  launcher_log="$artifact_dir/$label-launcher.log"
  if [ -f "$log" ]; then
    mv -f "$log" "$profile/Logs/dolphin.previous.log"
  fi

  setsid env \
    GAMECUBE_PASTA_BIN="$pasta_bin" \
    DOLPHIN_EMU_REAL="$dolphin_emu" \
    sh "$script_dir/run-dolphin-rootless-tap.sh" \
      --batch \
      --user="$profile" \
      --audio_emulation=HLE \
      --video_backend=Null \
      --config=Interface.ConfirmStop=False \
      --exec="$dol" >"$launcher_log" 2>&1 &
  launcher_pid=$!

  attempt=0
  max_attempts=$((timeout_seconds * 10))
  while [ "$attempt" -lt "$max_attempts" ]; do
    if [ -s "$log" ] && rg -Fq "$expected" "$log"; then
      break
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      echo "Dolphin exited before $label reached: $expected" >&2
      tail -80 "$launcher_log" >&2 || true
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Timed out after ${timeout_seconds}s waiting for $label: $expected" >&2
    tail -80 "$log" >&2 || true
    exit 1
  fi

  if ! shutdown_launcher "$label"; then
    cleanup_launcher
    exit 1
  fi
  if [ ! -s "$log" ]; then
    echo "Dolphin did not produce a log for $label." >&2
    exit 1
  fi
  cp "$log" "$artifact_dir/$label-dolphin.log"
  sh "$script_dir/check-dolphin-log.sh" \
    "$artifact_dir/$label-dolphin.log" >/dev/null
  pcap=$(newest_pcap "$profile")
  if [ -z "$pcap" ] || [ ! -s "$pcap" ]; then
    echo "Dolphin did not produce a BBA packet capture for $label." >&2
    exit 1
  fi
  tshark -r "$pcap" -Y 'tls.handshake.type == 1' -T fields \
    -e ip.dst -e tcp.dstport -e tls.handshake.extensions_server_name \
    -e tls.handshake.random_bytes \
    >"$artifact_dir/$label-client-hellos.txt" 2>/dev/null
}

assert_valid_boot() {
  label=$1
  log="$artifact_dir/$label-dolphin.log"
  for pattern in \
    'REFERENCE GX: TLS local entropy collected bytes=32' \
    'REFERENCE GX: TLS random source ready from local entropy-calls=1 bytes=32' \
    "REFERENCE GX: TLS connected host=$qa_host"; do
    if ! rg -Fq "$pattern" "$log"; then
      echo "$label is missing expected log evidence: $pattern" >&2
      exit 1
    fi
  done
  if ! rg -q "(^|[[:space:]])${qa_host}[[:space:]]" \
    "$artifact_dir/$label-client-hellos.txt"; then
    echo "$label did not capture a TLS ClientHello with SNI $qa_host." >&2
    exit 1
  fi
}

boot_1_profile="$work_root/boot-1"
create_profile "$boot_1_profile"
boot_until "$boot_1_profile" boot-1 \
  "REFERENCE GX: TLS connected host=$qa_host"
assert_valid_boot boot-1

boot_2_profile="$work_root/boot-2"
create_profile "$boot_2_profile"
boot_until "$boot_2_profile" boot-2 \
  "REFERENCE GX: TLS connected host=$qa_host"
assert_valid_boot boot-2

extract_client_random() {
  awk -F '\t' -v host="$qa_host" \
    '$3 == host && $4 != "" { print $4; exit }' "$1"
}

boot_1_random=$(extract_client_random "$artifact_dir/boot-1-client-hellos.txt")
boot_2_random=$(extract_client_random "$artifact_dir/boot-2-client-hellos.txt")
if [ -z "$boot_1_random" ] || [ -z "$boot_2_random" ]; then
  echo "Could not extract TLS ClientRandom bytes from both clean boots." >&2
  exit 1
fi
if [ "$boot_1_random" = "$boot_2_random" ]; then
  echo "Two clean boots emitted the same TLS ClientRandom bytes." >&2
  exit 1
fi
echo "Local entropy: two card-independent boots connected with distinct ClientRandom bytes."

cat >"$artifact_dir/summary.txt" <<EOF
HTTPS origin: $qa_url
Boot 1: no entropy GCI, TLS connected, ClientRandom bytes captured
Boot 1 shutdown: one Dolphin SIGTERM, TAP launcher status 0, empty process group
Boot 2: fresh profile, no entropy GCI, TLS connected, ClientRandom bytes captured
Boot 2 shutdown: one Dolphin SIGTERM, TAP launcher status 0, empty process group
Distinct TLS ClientRandom bytes: yes
EOF

echo "Dolphin entropy QA passed. QA logs are in $artifact_dir"

#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
provisioner="$script_dir/provision-tls-entropy.py"
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
work_root=

stop_launcher() {
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

cleanup() {
  stop_launcher
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

for command in python3 rg setsid strings tshark; do
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

  stop_launcher
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
    >"$artifact_dir/$label-client-hellos.txt" 2>/dev/null
}

assert_no_client_hello() {
  label=$1
  if [ -s "$artifact_dir/$label-client-hellos.txt" ]; then
    echo "$label emitted a TLS ClientHello despite unavailable entropy." >&2
    sed -n '1,20p' "$artifact_dir/$label-client-hellos.txt" >&2
    exit 1
  fi
}

assert_valid_boot() {
  label=$1
  log="$artifact_dir/$label-dolphin.log"
  for pattern in \
    'REFERENCE GX: TLS entropy seed rotated slot=A' \
    'REFERENCE GX: TLS random source ready from rotated seed entropy-calls=1 bytes=32' \
    "REFERENCE GX: TLS connected host=$qa_host"; do
    if ! rg -Fq "$pattern" "$log"; then
      echo "$label is missing expected log evidence: $pattern" >&2
      exit 1
    fi
  done
  rotations=$(rg -Fc 'REFERENCE GX: TLS entropy seed rotated slot=A' "$log")
  if [ "$rotations" -ne 1 ]; then
    echo "$label rotated the entropy seed $rotations times; expected exactly once." >&2
    exit 1
  fi
  if ! rg -q "(^|[[:space:]])${qa_host}$" \
    "$artifact_dir/$label-client-hellos.txt"; then
    echo "$label did not capture a TLS ClientHello with SNI $qa_host." >&2
    exit 1
  fi
}

missing_profile="$work_root/missing"
create_profile "$missing_profile"
missing_pattern='REFERENCE GX: TLS entropy unavailable: entropy seed is missing; provision Multiplex TLS Entropy.gci'
boot_until "$missing_profile" missing "$missing_pattern"
missing_log="$artifact_dir/missing-dolphin.log"
if rg -Fq 'REFERENCE GX: TLS random source ready' "$missing_log"; then
  echo "Missing-seed boot initialized TLS randomness instead of failing closed." >&2
  exit 1
fi
assert_no_client_hello missing
echo "Missing seed: failed closed before TLS ClientHello."

rotation_profile="$work_root/rotation"
create_profile "$rotation_profile"
rotation_gci="$rotation_profile/GC/USA/Card A/Multiplex-TLS-Entropy.gci"
python3 "$provisioner" "$rotation_gci" >/dev/null
boot_until "$rotation_profile" rotation-boot-1 \
  "REFERENCE GX: TLS connected host=$qa_host"
assert_valid_boot rotation-boot-1
first_generations=$(python3 "$provisioner" --inspect "$rotation_gci")
if [ "$first_generations" != 1,2 ]; then
  echo "First boot left entropy generations $first_generations; expected 1,2." >&2
  exit 1
fi
boot_until "$rotation_profile" rotation-boot-2 \
  "REFERENCE GX: TLS connected host=$qa_host"
assert_valid_boot rotation-boot-2
second_generations=$(python3 "$provisioner" --inspect "$rotation_gci")
if [ "$second_generations" != 3,2 ]; then
  echo "Second boot left entropy generations $second_generations; expected 3,2." >&2
  exit 1
fi
echo "Valid seed: rotated once per boot across generations 1,2 then 3,2."

corrupt_profile="$work_root/corrupt"
create_profile "$corrupt_profile"
corrupt_gci="$corrupt_profile/GC/USA/Card A/Multiplex-TLS-Entropy.gci"
python3 "$provisioner" "$corrupt_gci" >/dev/null
python3 "$provisioner" --corrupt "$corrupt_gci" >/dev/null
corrupt_pattern='REFERENCE GX: TLS entropy unavailable: both entropy seed copies are corrupt; reprovision the seed'
boot_until "$corrupt_profile" corrupt "$corrupt_pattern"
corrupt_log="$artifact_dir/corrupt-dolphin.log"
if rg -Fq 'REFERENCE GX: TLS random source ready' "$corrupt_log"; then
  echo "Corrupt-seed boot initialized TLS randomness instead of failing closed." >&2
  exit 1
fi
assert_no_client_hello corrupt
echo "Corrupt seed: failed closed before TLS ClientHello."

cat >"$artifact_dir/summary.txt" <<EOF
HTTPS origin: $qa_url
Missing seed: fail-closed, no TLS ClientHello
Boot 1 generations: $first_generations
Boot 2 generations: $second_generations
Corrupt seed: fail-closed, no TLS ClientHello
Unwritable card: not modeled because Dolphin reports guest writes before asynchronous host-file flush
EOF

echo "Dolphin entropy QA passed. QA logs are in $artifact_dir"

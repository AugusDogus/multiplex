#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

binary=$(sh "$script_dir/pcsx2-preflight.sh")
bios_path=$(sh "$script_dir/resolve-pcsx2-bios.sh")
binary_dir=$(dirname -- "$binary")
profile_dir="$binary_dir/inis"
bios_dir=$(CDPATH= cd -- "$(dirname -- "$bios_path")" && pwd)
bios_name=$(basename -- "$bios_path")

mkdir -p "$profile_dir" "$binary_dir/logs" "$binary_dir/snaps" \
  "$binary_dir/sstates" "$binary_dir/memcards" "$binary_dir/cache"

cat >"$profile_dir/PCSX2.ini" <<EOF
[UI]
SettingsVersion = 1
SetupWizardIncomplete = false
ConfirmShutdown = false
PauseOnFocusLoss = false
StartFullscreen = false
HideMainWindowWhenRunning = true
RenderToSeparateWindow = true

[Folders]
Bios = $bios_dir
Snapshots = snaps
Savestates = sstates
MemoryCards = memcards
Logs = logs
Cache = cache

[Filenames]
BIOS = $bios_name

[DEV9/Eth]
EthEnable = true
EthApi = Sockets
EthDevice = Auto
EthLogDHCP = true
EthLogDNS = true
InterceptDHCP = true
PS2IP = 192.0.2.100
Mask = 255.255.255.0
Gateway = 192.0.2.1
DNS1 = 192.0.2.1
DNS2 = 0.0.0.0
AutoMask = false
AutoGateway = false
ModeDNS1 = Internal
ModeDNS2 = Auto

[DEV9/Hdd]
HddEnable = false

[InputSources]
Keyboard = true
Mouse = false
SDL = false

[Pad]
MultitapPort1 = false
MultitapPort2 = false

[Pad1]
Type = DualShock2
Deadzone = 0
AxisScale = 1.33
ButtonDeadzone = 0
Up = Keyboard/Up
Right = Keyboard/Right
Down = Keyboard/Down
Left = Keyboard/Left
Triangle = Keyboard/I
Circle = Keyboard/L
Cross = Keyboard/K
Square = Keyboard/J
Select = Keyboard/Backspace
Start = Keyboard/Return
L1 = Keyboard/Q
L2 = Keyboard/1
R1 = Keyboard/E
R2 = Keyboard/3
EOF

echo "$binary"

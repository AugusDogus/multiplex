# Multiplex for GameCube

This is a real GameCube DOL whose shared UI is authored in restricted
TypeScript and Native SDK `.native` markup under `packages/console-ui`. Native SDK builds the widget tree, resolves
handlers, performs layout, and rasterizes its reference output on PowerPC. A
small libogc2/GX host presents that completed RGBA frame without recreating UI
semantics.

## Run

The host-side tooling is locked by `apps/gamecube/pyproject.toml` and
`apps/gamecube/uv.lock`. Install uv 0.12.1 using the
[official instructions](https://docs.astral.sh/uv/getting-started/installation/),
then sync the environment from the repository root:

```sh
bun run gamecube:setup
```

The project pins Python 3.13.14. The lock preserves exact Pillow,
cryptography, Ruff, Meson, Ninja, clang-format, clang-tidy, and ShellCheck
versions. Native lint also requires the Zig version in `apps/gamecube/PINS.env`.
Set `CLANG_FORMAT`, `CLANG_TIDY`, `SHELLCHECK`, `RUFF`, or `ZIG` to override
executable paths. The sanitizer suite
uses the pinned Zig 0.16.0 `zig cc` by default. Override it with
`GAMECUBE_SANITIZER_CC` when another ASan/UBSan-capable compiler is needed;
each compiler gets a separate Meson build directory.

From the repository root:

```sh
bun run gamecube:bootstrap
bun run gamecube:meson:setup
bun run gamecube:lint
uv run --project apps/gamecube --locked meson introspect \
  --targets build/native
bun run gamecube:test:portable
bun run gamecube:test:sanitize
bun run gamecube:analyze
bun run gamecube:check
bun run gamecube:reference:dol
bun run gamecube:reference:hardware-dol
bun run gamecube:bba-diagnostics:dol
bun run gamecube:reference:run
bun run gamecube:launch
bun run gamecube:reference:log-check
bun run gamecube:reference:smoke-player
bun run gamecube:reference:smoke-http-tap
bun run gamecube:reference:plex
bun run wii:reference:dol
bun run wii:reference:smoke-player
bun run wii:reference:plex
```

`gamecube:check` first performs a locked uv sync, bootstraps the pinned native
dependencies, then runs native lint, scoped clang-tidy analysis, portable C and
Python tests, Native SDK's TypeScript and null-platform tests, the PowerPC core
cross-compile, and host C tests under ASan and UBSan. These checks need no Plex
credentials, Dolphin installation, or console hardware.

The repository-root `meson.build` is the canonical extensible native graph.
It currently delegates to `apps/gamecube/meson.build`, where the portable auth
record implementation is an explicitly listed static library shared with its
host test. `bun run gamecube:meson:setup` writes
`build/native/compile_commands.json`; the committed `.clangd` points editors at
that database. Meson uses warnings as errors, exposes the named
`gamecube-portable` test suite, and has a locked Zig `zig cc` ASan/UBSan
profile. All project commands configure with `--wrap-mode=nodownload`.

The devkitPro Makefiles remain temporary DOL target adapters. They still own
the console source lists, linker scripts, generated assets, and DOL conversion
until equivalent Meson output can be compared safely. Cross-file templates and
the registration path for future clients are documented in
`apps/gamecube/cross/README.md`.

`gamecube:bba-diagnostics:dol` builds a small real-hardware diagnostic at
`apps/gamecube/multiplex-gamecube-bba-diagnostics.dol`. It keeps
its results on screen while checking the official DOL-015 device ID, Ethernet
link and DHCP lease, assigned network addresses, Plex at
`192.168.86.245:32400`, and the production Multiplex DNS and TCP 443 paths.
Reset the console to return to Swiss after recording the result.

The playback cog includes a runtime `Stats for nerds` toggle. It overlays UI
and decoder frame rates, average/maximum H.264 codec time, GX upload time, HLS
throughput, compressed queue depths, ready audio buffers, audio underruns, and
free heap. The toggle is off by default, so one hardware DOL serves normal use
and performance diagnosis. Fatal application paths remain on screen with a
stable `MGC-xx` code instead of silently returning to Swiss. A native exception
still shows libogc2's PC, LR, and DAR; resolve photographed addresses against
the exact release ELF with:

```sh
bun run gamecube:symbolize -- 0x80123456 0x80124567
```

Live GDB while streaming requires a USB Gecko in memory-card slot B. libogc2's
BBA GDB transport and the application's lwIP transport both own the same EXI
Broadband Adapter, so they cannot safely run together. The USB Gecko setup
follows the [GameCube debugging guide](https://themkat.net/2023/01/13/gamecube_debugging.html):
link `libdb`, initialize `GDBSTUB_DEVICE_USB`, break, then attach the pinned
`powerpc-eabi-gdb` to the exact ELF.

`gamecube:reference:run` uses an isolated Dolphin profile and replaces
its previous recorded process, keeping one emulator instance open. The managed
profile exposes a component-capable output, so the presenter selects 640x480
progressive scan; composite-only hardware falls back to the preferred
interlaced mode. When the launcher itself inherited Linux `SCHED_IDLE`, as
commands launched from T3 Code do, it starts Dolphin in a transient
normal-priority user service. This requires no sudo, preserves the one-window
cleanup behavior, and prevents an apparently 60 fps guest from advancing much
slower than wall time. The isolated profiles also pin Dolphin's fallback
region to North America so region-free DOL boots consistently reopen the same
`MemoryCardA.USA.raw` sign-in save.

The GameCube save remains two blocks and now carries a native RGB5A3 icon
rendered from the Multiplex logo plus two Memory Card Manager comment lines.
Existing iconless saves migrate in place after their credentials load, while
the two independently recoverable auth records remain intact.

The Wii target compiles the same TypeScript, `.native` markup, PowerPC
core, validated RGBA frame, direct GX presenter, and media pipeline
with libogc2's Wii runtime. One `Makefile.reference` builds both consoles at
the same `-Werror` discipline; `MULTIPLEX_PLATFORM` confines the differences
to the libogc2 rules include, target name, build directory, and the `-lbba`
versus `-lwiiuse -lbte` link. `wii:reference:dol` builds the Wii DOL, and CI
cross-builds it next to the GameCube DOL so the target cannot rot unnoticed.
`wii:reference:smoke-player` boots the Wii DOL
in Dolphin and passes the same navigation, MPEG-2/MP2 playback, 60 fps,
pause/resume, and invalid-access gates as GameCube. On Wii the Wii Remote and
Classic Controller D-pads move focus, mirroring the GameCube analog stick,
because a bare Wii Remote has no stick; GameCube pads plugged into a Wii keep
their GameCube semantics, including the D-pad search cursor. The player smoke
walks focus both directions across the home shelf, details actions, and
player transport before each activation, and re-reveals the auto-hidden
player controls before resuming playback. `wii:reference:plex` uses Dolphin's native Wii IOS network
stack. Because Dolphin's native network stacks share the host network, the
default gateway mode serves the console gateway on the host loopback instead
of a TAP gateway address; the full scripted flow ran against a live remote
PMS and rendered the real three-row home catalog with poster artwork,
controller-authored search, gateway details, and gateway playback with zero
audio underruns. The direct-Plex mode carries PMS traffic and the same
persisted Multiplex memory-card session as GameCube. It reaches Multiplex only through the HTTPS Portless
origin, `https://multiplex.localhost`; the runner maps that hostname to the
host loopback address inside Dolphin while retaining its TLS hostname and
embedded Portless CA. No TAP device, pasta process, alternate Multiplex port,
or Portless service change is required. Wii network receives are intentionally
bounded to 16 KiB because libogc allocates an IOS IPC buffer matching each
`net_recv` request. The direct-Plex smoke loaded the authenticated tRPC user,
rooms, and invitees, read the 100,005-byte Plex home response, decoded all 12
posters, and played a real Plex item with a clean Dolphin invalid-access log.
The Wii Watch Together smoke resolves Plex's public Syncplay host through IOS,
gates playback on both invited users, and passes synchronized seek,
bidirectional pause/resume, browser disconnect/rejoin, room disband, and PMS
cleanup through the same Portless-backed Multiplex API.

The reference build embeds curl's pinned Mozilla public CA bundle and requires
normal certificate and hostname verification for HTTPS. When
`MULTIPLEX_BASE_URL` is an HTTPS `*.localhost` origin, the build appends the
public Portless CA from `~/.portless/ca.pem`. `GAMECUBE_TLS_CA_FILE` remains the
explicit override for another private development CA. Private keys and
generated host certificates are never copied into the build. Follow the
[Mbed TLS upgrade guide](TLS-UPGRADE.md) when you change the pinned dependency.

### TLS entropy

The GameCube has no documented hardware random-number generator. At boot, the
client hashes the BBA MAC and assigned IP, RTC and processor timebase samples,
video retrace state, console configuration, CPU temperature when available,
thread state, and process addresses into a 32-byte local seed. Mbed TLS then
uses that seed with CTR-DRBG for every HTTPS client. No entropy save, host-side
provisioning, or first-connection service is required.

Stable identifiers provide device diversity, while fine-grained timing and
runtime measurements provide the unpredictable portion. This is a pragmatic
homebrew threat model, not a claim that the console supplies 256 bits of
hardware entropy. It avoids predictable non-cryptographic generators while
keeping first boot and recovery completely automatic.

#### Physical-hardware validation

Use the hardware libogc2 profile. No memory card preparation is needed. Capture
the serial log with a USB Gecko when available, or photograph the on-screen
diagnostic:

1. Boot without an account save and require `TLS local entropy collected`,
   `TLS random source ready from local entropy`, and a successful TLS 1.2
   connection in the log.
2. Power-cycle and require another successful TLS connection without importing
   or creating an entropy GCI.
3. Pair the console, load the HTTPS catalog and artwork, start direct Plex
   playback, and join a Watch Together room. Confirm HTTPS catalog, artwork,
   playback-control, and Syncplay traffic succeeds without changing the
   existing startup or free-memory diagnostics.

The isolated Dolphin integration QA additionally requires `tshark`, the pinned
patched Dolphin build, and the rootless TAP prerequisites. It builds a DOL for
an HTTPS origin, boots two fresh profiles without an entropy GCI, requires both
TLS connections, and verifies that their captured ClientRandom bytes differ:

```sh
bun run gamecube:dolphin:bootstrap
bun run gamecube:reference:entropy-qa
```

The default HTTPS origin is `https://example.com`. Set
`GAMECUBE_ENTROPY_QA_URL` to a public Multiplex deployment to exercise the real
device-authorization endpoint without a Plex token. The command retains logs
and ClientHello summaries under `.dolphin-entropy-qa/`, but deletes every
temporary profile and never records the local seed.

For each boot, the harness sends one `SIGTERM` directly to Dolphin, requires
the rootless TAP launcher to exit with status 0 without escalation, and checks
that the process group is empty. Plex catalog, artwork, playback, and Syncplay
acceptance still requires a linked Plex account and remains covered by the
direct-Plex Dolphin workflow below and the physical-hardware procedure above.

`gamecube:reference:smoke-http-tap` builds the DOL with a local HTTP
media URL, creates an unprivileged network namespace, and connects Dolphin's
low-level emulated BBA to a rootless `pasta` Ethernet uplink. It does not
modify the host's physical network and does not require sudo. The bootstrap
pins a `pasta` revision containing its June 2026 fix for padded minimum-size
IPv4 frames and its December 2025 non-local-throughput work. A narrow local
patch lets a single final handshake ACK carry the first HTTP request instead
of silently discarding that payload. The libogc2 build also backports lwIP's
upstream RFC-correct `snd_nxt` fix so a retransmission cannot move the
GameCube's outgoing TCP sequence backward. Together these remove the
connection-level retransmission delays without host privileges. Pasta's
interactive-traffic heuristic normally waits for the remote peer before
acknowledging guest bytes. That produces a duplicate-ACK storm with libogc2's
tiny window and TLS records, a pattern also diagnosed by pasta's
maintainers for small-message protocols. The dedicated local pasta build
acknowledges a guest with a two-MSS-or-smaller window immediately; this changed
the authenticated Watch Together request from a 30-second timeout to a valid
sub-second chunked response without changing the host or requiring sudo. The
Dolphin TAP harness limits libogc2's TCP receive window to one MSS because the
emulator can otherwise enqueue two Ethernet frames before the BBA advances its
approximately two-frame ring. A final pasta patch drains more host-socket data
whenever that small guest advances its ACK; without it, pasta's edge-triggered
socket path sent only one segment per second after the initial burst. Set
`GAMECUBE_PASTA_CAPTURE=1` to write `/tmp/multiplex-pasta.pcap` without
enabling timing-heavy trace logs.

`gamecube:reference:plex` discovers a LAN Plex server (or uses
`PLEX_BASE_URL`), selects its latest playable item by default, transcodes a
two-minute segment to the bounded GameCube MPEG-2/MP2 profile, and opens it in
Dolphin through the same rootless BBA path. Set `GAMECUBE_PLEX_RATING_KEY`,
`GAMECUBE_PLEX_OFFSET`, or `GAMECUBE_PLEX_DURATION` to choose the item or
segment. `PLEX_TOKEN` is supported for servers that require LAN
authentication. After `scripts/plex-pair.py` has claimed a PIN into the
default ignored `.plex-cache/auth.json`, the runner loads that device session
automatically. Plex's July 2026 resource-directory implementation currently
returns the account JWT where current PMS expects a traditional server token,
so `pms-start`/`pms-poll` add that compatibility credential to the same
ignored state. `PLEX_TOKEN` remains an explicit development override. The
runner auto-navigates to the player and mutes only
Dolphin's PipeWire sink input; AI DMA remains active inside the emulator.
Set `GAMECUBE_PLEX_SEGMENT_DURATION=8` and
`GAMECUBE_PLEX_EXPECT_CONTINUATION=1` for the accelerated timeline-boundary
smoke test. Set `GAMECUBE_DIRECT_PLEX=1` with
`MULTIPLEX_BASE_URL=https://multiplex.localhost` to skip the development
gateway and exercise the paired console's saved memory-card credentials,
direct PMS catalog/artwork requests, HLS transcode, seek, and timeline
reporting. `GAMECUBE_PLEX_WAIT_ARTWORK=0` may skip the automation wait for all
twelve home posters while iterating on playback. The requested PMS profile is
also repeatable through `GAMECUBE_PLEX_VIDEO_RESOLUTION` and
`GAMECUBE_PLEX_MAX_VIDEO_BITRATE`; the conservative defaults are
`480x270`/`700`, which PMS currently resolves to a 480x270, 576 kbps stream.
`GAMECUBE_PLEX_SUSTAIN_SECONDS` controls the post-resume failure window and
defaults to 45 seconds.

Direct Plex playback automatically advances episodes in server order. The
resolver follows the current season first, then crosses into the first episode
of the next non-empty season. The outgoing episode reports its final stopped
timeline before the next HLS session starts at offset zero. For the accelerated
Dolphin regression, set `GAMECUBE_PLEX_START_OFFSET_MS` near the selected
episode's duration, `GAMECUBE_PLEX_EXPECT_AUTOPLAY_NEXT=1`, and
`GAMECUBE_PLEX_AUTOPLAY_RATING_KEY` to the expected next episode.
Watch Together uses the same resolver, discovers or creates the next room,
moves both clients to the next episode, and deletes the completed room. Add the
normal Watch Together test variables to run that transition through Dolphin
and the real browser guest.

Direct playback also parses Plex's bounded subtitle stream metadata. When a
track with a transcode index is selected on the server, the GameCube HLS
session asks Plex to burn that track into the DVD-resolution video and retains
the selection across seeks. A focusable icon-only player control cycles among
the available indexed tracks and Off, with its active treatment reflecting
whether captions are enabled. Unsupported or unselected tracks leave
subtitles disabled without changing the audio/video pipeline. Set
`GAMECUBE_PLEX_TEST_SUBTITLE_CYCLE=1` to exercise the control against an item
whose server metadata already selects an indexed track.

The GameCube shell now uses the Multiplex mark, flush 140x210 poster art, and
Native SDK's focus treatment without prototype badges or duplicate navigation
actions. Playback is aspect-fitted inside a fullscreen 640x480 video surface.
Its compact bottom bar uses icon-only transport controls, fades over 180 ms
after four seconds without input, and restores on the next controller action.
The progress track fades with the rest of the chrome. Every Native repaint runs
layout checks for text overflow, sibling overlap, viewport escape, and damaged
hit targets, plus a dedicated zero-inset poster check. Set
`GAMECUBE_PLEX_FOCUS_AUDIT=1` to cycle every focus target on Home, Libraries,
a real library page, the complete QWERTY keyboard, search results, the selected TV
hierarchy, and the player before the real Plex smoke can pass.

Set `GAMECUBE_PLEX_WATCH_TOGETHER=1`,
`GAMECUBE_WATCH_TOGETHER_INVITEE_ID=<plex-user-id>`, and
`GAMECUBE_WATCH_TOGETHER_BROWSER_GUEST=1` to run the cross-platform Watch
Together smoke. It uses the real guest session saved by the web Playwright
setup, has that account join the room created in Dolphin, verifies playback
advances in both clients, exercises play/pause synchronization in both
directions, and verifies browser-originated seeking reloads both clients at the
same PMS offset. It also disconnects and rejoins the browser participant without
recreating the room. The browser is headless and muted while Dolphin remains
visible. During playback the Native UI shows live participant presence, Leave
room, and a Reconnect action backed by automatic one-second Syncplay retries. A
host-only Disband room action reuses the web app's existing
`plex.deleteWatchTogetherRoom` mutation. The smoke requires a fresh GameCube
Syncplay connection, then requires Disband room to stop Plex playback, close
Syncplay, and remove the room from the shared API before it passes. Cleanup
closes both clients and clears the exact GameCube client session from PMS.

`scripts/plex-pair.py` implements Plex's current device-key PIN flow without
placing an account password or long-lived legacy token on the console. `start`
creates an Ed25519 device identity and strong PIN, `poll` exchanges a claimed
PIN for Plex's seven-day JWT, and `ensure` renews a token within one day of
expiry using Plex's nonce exchange. Its state file is mode `0600` and belongs
under the ignored `.plex-cache` directory. The gateway receives the ensured
server-specific access token through its process environment, never through
command-line arguments; the account JWT is used only with Plex's resource
directory and future account-backed features.

The app retains four separate artifacts:

- `multiplex-gamecube-native-reference-dolphin.dol`: Dolphin integration build
  presented through direct GX.
- `multiplex-gamecube-native-reference-hardware.dol`: physical DOL-015 build
  presented through direct GX; this is the recommended visual baseline.
- `multiplex-gamecube-legacy.dol`: the earlier command-to-GX approximation.
- `multiplex-gamecube-raylib-reference.dol`: the portability experiment. Its
  framebuffer and texture uploads work, but raylib4Consoles/OpenGX currently
  fails to draw the textured quads correctly on the tested GameCube stack.

## Build profiles

The reference application and the BBA diagnostic each build against one of
three libogc2 stages, selected by `REFERENCE_VARIANT` /
`LIBOGC2_STAGE_NAME`. All three share the same pinned libogc2 commit from
`PINS.env`; they differ only in which local patches are applied:

| Profile    | libogc2 stage             | Local libogc2 changes                                                                                                           | Purpose                                                                                                                            |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `dolphin`  | `.libogc2-stage`          | Full patch stack: TCP write/window flushes, BBA receive-ring DMA wrap and recovery, DHCP ordering and retry, lwIP `snd_nxt` fix | Deterministic development and automation against Dolphin's emulated TAP BBA                                                        |
| `hardware` | `.libogc2-hardware-stage` | Exactly one change: `TCP_WND` limited to one `TCP_MSS`                                                                          | The physical DOL-015 acceptance build; excludes every Dolphin-motivated receive-driver patch so hardware results stay attributable |
| `clean`    | `.libogc2-clean-stage`    | None; the checkout is verified pristine                                                                                         | Control build for isolating whether a failure is caused by our local patches at all                                                |

Physical hardware is the acceptance target; Dolphin is only the development
harness. The separate profiles exist to keep hardware evidence uncontaminated
by emulator workarounds while those workarounds are still under evaluation.
They are temporary isolation, not an architectural requirement: as patches are
either upstreamed or proven unnecessary, the profiles should converge.

Only the `-hardware` artifact should be copied to an SD card and launched on a
physical console. The `-dolphin` artifact links emulator-oriented network
patches, and the build system emits distinctly named artifacts precisely so
one cannot silently overwrite the other.

The controller profile attaches a standard controller to SI port 1 and is
backed by `.dolphin-user/Pipes/multiplex1`. Dolphin pipe commands such as
`PRESS A`, `RELEASE A`, and `SET MAIN 1 0.5` drive the automated player smoke
test. The main analog stick moves focus spatially using dead-zone and repeat
behavior adapted from WiiMC-GCN's libwiigui. On Search, D-pad left/right moves
the query cursor, X deletes before it, and R submits. Z opens Search, Y opens
Libraries, and X advances the home hub outside Search.

For manual use, `bun run gamecube:launch` starts Portless when needed,
builds the linked Plex DOL, and opens an interactive TAP-backed Dolphin
session. Do not launch the linked DOL with bare `dolphin-emu --exec`: its TAP
profile requires the rootless network environment created by this launcher.

For focus-free manual QA, `bun run gamecube:qa -- launch` starts the same
interactive session. `navigate right` moves the analog stick once and `press a`
sends a button through that same pipe.
`status`, `check`, and `screenshot [name]` expose the current render telemetry,
validate the Dolphin log, and capture the emulated framebuffer without
activating a Dolphin window. `scenario navigation` relaunches and captures
repeatable Home, Search, and Libraries baselines under
`.dolphin-user/QACaptures`. `scenario playback` relaunches, opens the first
Continue Watching item, and verifies details, fullscreen video, control fade,
reveal-only A, second-A pause, resume, clean logs, and stable presentation.
`scenario focus-gallery` captures every focus target on Home, Search,
Libraries, the first library page, and item details, then assembles a labeled
contact sheet for each screen in the same capture directory.
`scenario player-gallery` does the same for the Details Start menu and every
player control while the real Plex stream plays, then enforces stable 60 FPS.
`scenario full-gallery` combines both galleries.
The screenshot hotkey uses a separate Dolphin pipe, so this workflow does not
invoke desktop automation or GNOME Remote Desktop. The tracked controller
profile also accepts the connected Steam Controller alongside the QA pipe.

## Source map

- `packages/console-ui/src/core.ts`: shared application model and update function
- `packages/console-ui/src/app.native`: declarative pairing, home, search, library browser,
  details, and player views
- `packages/console-ui/src/console_ui.zig`: compiled view, layout, focus/handler resolution,
  GPU-packet translation, and C ABI
- `host-reference-gx/main.c`: reference framebuffer and direct-GX presenter
- `host-reference-gx/gui_navigation.c`: attributed libwiigui-style analog
  dead-zone and repeat adapter
- `packages/console-ui/reference-frame/reference_frame.c`: platform-neutral guarded RGBA frame
  allocation, Native SDK rendering, and deterministic frame signatures
- `host-reference-gx/trpc_client.c`: bounded Better Auth bearer transport for
  the same tRPC procedures used by the web client
- `host-reference-gx/trpc_rooms.c`: fixed-capacity Watch Together room parser
- `host-reference-gx/mpeg2_decoder.c`: narrow wrapper around MPlayer CE's
  bundled FFmpeg MPEG-2 decoder
- `host-reference-gx/mp2_decoder.c`: fixed-point MPlayer CE FFmpeg MP2 decoder
- `host-reference-gx/mpeg_ps_demux.c`: MPEG-2 Program Stream PES extraction
  and initial 90 kHz PTS preservation
- `host-reference-gx/audio_dma.c`: buffered Audio Interface DMA output adapted
  from WiiMC-GCN's `ao_gekko` driver
- `host-reference-gx/http_client.c`: bounded libogc2/BBA range and sequential
  HTTP reader
- `host-reference-gx/yuv420_gx.c`: tiled planar-YUV upload and GX TEV
  conversion/scaling
- `scripts/smoke-dolphin-player.sh`: player navigation, animation,
  pause/resume, and invalid-access assertions
- `scripts/run-dolphin-rootless-tap.sh`: isolated TAP-to-`pasta` Ethernet
  harness for exercising Dolphin's low-level BBA emulation without sudo
- `scripts/dolphin-entropy-qa.sh`: card-independent local entropy and HTTPS
  validation on the pinned Dolphin/TAP stack
- `scripts/bootstrap-dolphin.sh`: reproducible local Dolphin 2606 build using
  the installed 2606 system data and the TAP receive-pressure patch
- `patches/dolphin-2606-tap-receive-backpressure.patch`: admits one Linux TAP
  frame at a time until libogc retires its BBA receive descriptor and wraps
  DMA reads at the configured BBA receive-ring boundary
- `scripts/run-dolphin-plex.sh`: real Plex item → GameCube transcode gateway →
  muted Dolphin runner
- `scripts/plex-gateway.py`: bounded binary home/search/library metadata and
  JPEG artwork gateway backed by the real Plex server
- `host/main.c`: earlier command-to-GX approximation
- `host-raylib/main.c`: experimental raylib/OpenGX presenter
- `scripts/generate-font-atlas.py`: converts Native SDK's bundled Geist Regular
  to an antialiased, GX-tiled I8 atlas
- `scripts/generate-demo-mpeg2.sh`: regenerates the embedded MPEG-2 Program
  Stream with 720x480, 30000/1001 fps video and 48 kHz stereo MP2 audio
- `patches/native-sdk-single-threaded-canvas.patch`: the two small portability
  changes applied to the pinned Native SDK checkout
- `patches/native-sdk-reference-render-fast-paths.patch`: exact-output
  scanline and solid-blend fast paths for rounded fills, borders, and shadows
- `patches/native-sdk-panel-focus-indicator.patch`: draws a compact accent
  underline beneath focused poster cards and other pressable panels
- `patches/libogc2-lwip-rfc-snd-nxt.patch`: upstream lwIP sequence-number
  semantics backported to libogc2's historical TCP stack
- `patches/libogc2-start-bba-after-link.patch`: starts DHCP 100 ms after BBA
  link-up instead of imposing a five-second switch compatibility delay
- `patches/libogc2-start-network-worker-before-dhcp.patch`: starts lwIP packet
  processing before sending DHCP discovery so immediate offers are not missed
- `patches/libogc2-arm-dhcp-state-before-send.patch`: arms DHCP receive states
  before transmitting and retries a lost initial discovery after 500 ms
- `patches/libogc2-flush-tcp-window-updates.patch`: immediately ACKs consumed
  TCP data, advertises receive space in complete windows, and limits the
  Dolphin TAP test path to one in-flight Ethernet frame
- `patches/passt-handle-data-on-handshake-ack.patch`: preserve application
  data piggybacked on the final TCP handshake ACK
- `patches/passt-ack-small-window-guests-immediately.patch`: avoid delayed
  host ACKs for the BBA's tiny TCP receive window
- `patches/passt-avoid-spurious-small-window-retransmit.patch`: leave loss
  recovery to the host TCP socket when a tiny guest window cannot provide the
  three duplicate ACKs required for fast retransmit
- `patches/passt-pull-small-window-on-ack.patch`: drain the next host segment
  as soon as a one- or two-MSS guest advances its ACK
- `patches/passt-floor-small-window-guest-send.patch`: keep one MSS of
  guest-facing send window available so old lwIP cannot deadlock a queued TLS
  record when pasta mirrors a smaller host-socket window

## Current boundary

The direct-GX reference presenter preserves Native SDK's font rasterization,
antialiasing, rounded corners, strokes, shadows, and compositing. It divides
the 640x480 RGBA frame into sixteen 160x120 GX RGBA8 textures and presents them
through double-buffered XFBs. A real Native SDK `<video>` element exposes its
laid-out media-surface rectangle over the C ABI; the GX host composites a
decoded 720x480 frame into that exact rectangle. The DOL embeds a 30-frame
MPEG-2 Program Stream generated at NTSC DVD resolution and 30000/1001 fps,
with a 48 kHz stereo MP2 track. The in-DOL demuxer extracts the first `0xE0`
video and `0xC0` audio PES payloads and preserves their initial 90 kHz PTS
values. The deterministic asset starts video 902 ticks (481 audio samples)
after audio, and that offset establishes the shared clock epoch. MPlayer CE's
pinned, GameCube-optimized FFmpeg decodes video to YUV420P on a worker LWP.
The host tiles those three planes into double-buffered GX I8 textures, and a
fixed-function TEV pipeline performs limited-range BT.601 YUV-to-RGB
conversion and scaling. There is no CPU RGB conversion or low-resolution
intermediate. A second lower-priority producer decodes MP2 into 5,760-byte PCM
bursts, with 18 aligned buffers handed directly to the GameCube Audio
Interface DMA. Buffer ownership explicitly distinguishes the currently
playing and hardware-queued blocks; the decoder producer never touches either
one. Play/Pause holds and resumes both pipelines without rerasterizing video
into the UI framebuffer.

The reference render now uses one pass rather than rendering the same pixels
three times. Exact-output scanline fast paths avoid walking the empty interior
of rounded borders, evaluate rounded coverage only at edge ramps, and reuse
the constant shadow blend across matching destination pixels. Square-cornered
media fills use the same span path. In Dolphin this reduced pairing from about
0.55 to 0.33 seconds, cold home from 7.13 to 0.49 seconds, and cold details
from 8.02 to 0.45 seconds without changing their framebuffer signatures.
Player UI changes render in about 0.275 seconds and focus-only home changes
cost about 0.068 seconds.
Real cards now load a bounded full-metadata response on demand. The Native SDK
details view renders the selected poster, badges, title/tagline, year/runtime/
rating facts, directors, genres, wrapped synopsis, resume state, and playable
action without adding a JSON parser to the GameCube runtime.
Play enters a preparing view and requests the manifest for the selected rating
key; the video surface becomes visible only after the gateway and guest both
validate an exact session match.
While playing, the GameCube L/R triggers request a bounded 30-second backward
or forward seek. The gateway caches segments by rating key and logical offset;
the guest pauses AI DMA, replaces the HTTP/demux/codec session, and resumes
only after the new segment reaches its prebuffer threshold.
The AI DMA sample clock drives a lightweight GX progress bar without repainting
the Native SDK tree. It also requests the next segment at the current boundary;
the accelerated Dolphin run crossed consecutive real Plex segments with zero
invalid accesses and zero audio underruns. Cold preparation is still
expensive and originally caused an approximately seven-second boundary gap.
The gateway now performs the one-segment-ahead encode concurrently and
coordinates duplicate requests per timeline key, without serializing an
unrelated user seek. Dolphin confirms the next file is ready before the
boundary. The guest concurrently opens that HTTP source and fills a second
bounded demux session, then transfers it to the codecs after cancelling the old
reader. In the 12-second accelerated run, three consecutive staged ownership
swaps took 17–23 ms and resumed playback in roughly 0.3–0.4 seconds.
Before opening the second demux, the host drops Native SDK's reference-render
memo while retaining the already-uploaded GX frame. The first real Plex
prefetch released 3,876 KiB, leaving enough MEM2 for the full 320 KiB video and
64 KiB audio queues instead of weakening their interleave tolerance. Six
consecutive eight-second handoffs then switched in 14–26 ms with zero
underruns and a clean invalid-access log.
Intentional session replacement now cancels the old resumable HTTP reader
instead of waiting through its outage-retry budget. A 64 ms handoff margin
also stops the finite audio stream before its final DMA request; the repeated
accelerated-boundary run returned to zero underruns and a clean memory log.
The console reports the same Plex `/:/timeline` contract as the web player.
Gateway-backed development playback still proxies the request, while a paired
console sends it directly to the selected PMS with the server token, stable
client identifier, and active playback-session identifier restored from its
memory-card record. A dedicated LWP sends play/pause/stop edges immediately and
playing progress every ten seconds, so Plex latency cannot stall GX or AI DMA.
The direct-Plex Dolphin run confirmed real playing, paused, resumed, and
periodic progress acknowledgements without starting the gateway or preparing a
host-side media file. PMS selected a 320x180 H.264/AAC HLS variant at 24 fps;
the console held 23.8–24.0 decode fps and 60.4 presentation fps with zero
underruns and a clean invalid-access log. Its bounded playlist reader accepts
Plex's full 23 KiB static movie playlist, retains only the next 32 segment
records, and starts the consumers at 16 KiB per elementary stream so either
mux order can make progress. Long segment bodies use their own TCP connection
instead of holding the short-control mutex while codec queues backpressure, so
pause/resume and ten-second timeline reports remain independent. Leaving the
player also
commits the current offset and integer progress percentage into the
TypeScript-owned home, search, or library item. Reopening that same item in the
verified run resumed at 7,547 ms without reloading the catalog.

A 640x360/1000 profile run made PMS select a 640x360, 822 kbps H.264/AAC
variant. Releasing the obsolete browse/details reference-render memo before
opening H.264 recovered 3.8 MiB and fixed reference-picture allocation failures
at that resolution; the seeked replacement released another 589 KiB. A short
sample reached 24.2 decoded fps, but sustained scene complexity later pulled
the decoder down to 17 fps and produced audio underruns, so 360p is not a safe
default.

The selected 480x270/700 default resolves to 576 kbps. A sustained direct-PMS
run crossed eight 8-second segments and about 2,100 audio DMA buffers while
holding the 24 fps source predominantly at 23.7–24.5 decoded fps. It retained
60.4 presentation fps, direct play/pause/resume and periodic timeline
acknowledgements, zero audio underruns, and a clean invalid-access log. The
45-second smoke window is intentionally long enough to reject the delayed
failure observed at 360p.
Show and season details now load Plex's existing
`/library/metadata/{ratingKey}/children` hierarchy in bounded four-item pages.
The Native SDK details view can traverse show → season → episode, page with
L/R, return through its bounded navigation history, and start the selected
episode without a console-only API. The direct-PMS Dolphin smoke searched for
Cowboy Bebop, selected Season 1, paged to episodes 5–8, played episode rating
key `380571`, sought to 31 seconds, paused/resumed, returned to 60.4 fps, and
reported zero audio underruns and no invalid accesses. Set
`GAMECUBE_PLEX_KEEP_OPEN=0` when the runner should force-close Dolphin after a
successful automated check.
The first Watch Together increment also calls the web app's existing
`plex.getWatchTogetherRooms` tRPC procedure rather than adding a console-only
query. Dolphin completed TLS 1.2 through Portless, authenticated the restored
Better Auth bearer token, decoded the chunked SuperJSON envelope, and parsed
the bounded room result before loading the direct Plex catalog. The item-details
screen can now call the existing `plex.createWatchTogetherRoom` mutation and
render the returned room in the Native SDK view. A live Dolphin run created a
real room for rating key `416278`, then immediately refreshed the list back to
the same room. The BBA transport uses 224-byte TLS plaintext records, so both
tRPC control requests fit in bounded records. Repeated HTTPS
connections and a refresh immediately after cancelling an active poster load
now complete without the earlier 30-second lost-record timeout.
The cross-platform smoke now replaces the synthetic second participant with
the real `multiplextest` web session. A Dolphin-created room gathered both
users, advanced the same PMS item in Chromium and on GameCube, followed a
31-second GameCube seek, propagated GameCube pause/resume to the browser, and
propagated browser pause/resume back to GameCube. Clearing the room's stale
paused handshake event when the console arms its initial local play claim keeps
the lobby baseline from immediately stopping the decoder. The run remained
free of invalid accesses, decoder failures, and audio underruns.
A bounded reference-render memo retains three expensive stable layers; warmed
full home and details repaints measured about 0.37 and 0.33 seconds. The memo
has a 4 MiB hard limit and peaked at 4,093 KiB in the home/details flow.
RGBA-to-GX conversion remains about 10 ms and the retained frame presents at a
measured 60.4 progressive frames per second when video is paused. The current
DVD-resolution stream derives its 30000/1001 cadence from completed Audio
Interface PCM bursts, with interpolation inside the active burst. It returns to 60.4
presentation fps after long MPEG I-frames. Average decode plus tiled upload is
about 8.2 ms; the fast MPEG-2 path lowers the I-frame maximum to about 35.3 ms,
and the audio clock schedules a catch-up frame after a missed VBlank. Audio
ran without an underrun through the automated pause/resume flow. HTTP metadata
inspection uses a seekable 32 KiB range cache; playback uses resumable byte
ranges on a producer LWP, with a bounded 256 KiB cache for tiny looping media.
The MPEG-PS producer fills fixed 320 KiB
video and 64 KiB audio rings, while the codecs retain only 32 KiB and 8 KiB
compressed input windows. No container or elementary stream is allocated at
its full length. A versioned host-prepared stream now exposes its URL, full
duration, segment start/duration, sizes, packet counts, and first PTS through a
bounded runtime playback manifest, reducing the
real Plex-derived smoke from a full scan to one range request before sequential
playback without compiling session data into the DOL. That run decoded at 29.9
fps, presented at 60.4 fps, completed pause/resume with zero underruns, and
produced a clean Dolphin memory log. Dolphin 2606's BuiltIn HLE backend still
stalls after its first responses; TAP remains the passing low-level BBA control.
With the TCP sequence and handshake fixes, the rootless TAP path loads the
catalog immediately, transfers a 35,151-byte artwork response in single-digit
milliseconds, completes the Portless TLS connection in about 0.19 seconds,
and completes the authenticated tRPC request in about 0.44 seconds. Pasta
packet tracing is intentionally disabled for performance runs because
per-frame trace and PCAP output materially slows emulation.

The [Linux TAP backend in stock Dolphin
2606](https://github.com/dolphin-emu/dolphin/blob/6094cfcf7b8fba733b3116fdf3414d51c1c0e4a4/Source/Core/Core/HW/EXI/BBA/TAP_Unix.cpp)
reads host frames without applying the receive-ring occupancy guard already
used by [Dolphin's BuiltIn BBA
backend](https://github.com/dolphin-emu/dolphin/blob/6094cfcf7b8fba733b3116fdf3414d51c1c0e4a4/Source/Core/Core/HW/EXI/BBA/BuiltIn.cpp).
Under sustained Plex responses that can overrun the emulated 4 KiB BBA ring
before libogc2 advances its read pointer. `bun run
gamecube:legacy:dolphin:bootstrap` builds the pinned Dolphin source with a narrow
patch that waits for libogc to retire the current receive descriptor before
reading another TAP frame, checks receive enablement before consuming it, and
snapshots and validates every receive-ring page before copying packet bytes
into the 4 KiB BBA memory. Libogc's `RHBP=0x10` is the exclusive end of that
memory. Both its wrapped DMA reader and Dolphin now wrap before page `0x10`.
This removes the dropped segment and one-second TCP retransmission cycle while
preserving the real adapter's memory boundary. The rootless TAP runner
automatically prefers this local build and retains stock Dolphin as a fallback
when it has not been built.

Pasta's interactive-flow ACK suppression also interacts badly with libogc2's
historical two-MSS advertised window: repeated ACKs for tiny TLS records made a
valid Multiplex tRPC request take about 30 seconds. One pinned pasta patch keeps
immediate host ACKs for guests advertising at most two MSS while leaving
upstream behavior unchanged for ordinary larger-window peers. Pasta also treats
a single duplicate guest ACK as a fast-retransmit request. That is useful for
ordinary large windows, but creates a retransmit loop for a peer that can only
hold one or two segments. A second narrow patch disables that shortcut for
these small windows and leaves recovery to the host TCP socket. Standard TCP
fast retransmit uses [three duplicate
ACKs](https://www.rfc-editor.org/info/rfc5681), which such a peer cannot
produce. These changes follow the [upstream pasta small-buffer
investigation](https://archives.passt.top/passt-dev/ZREgC%2FuksH%2B2ol1b%40zatzit/T/)
and its [documented small-message ACK
behavior](https://github.com/podman-container-tools/podman/discussions/24572);
no privileged TAP device or Portless service change is required.
Because pasta's socket side uses edge-triggered readiness, a third patch pulls
the next segment from an already-readable host socket whenever the small guest
advances its ACK. This preserves the BBA-sized in-flight limit without waiting
for a readiness edge that cannot recur while unread bytes remain queued.

The old stack exposed a second bottleneck independent of Dolphin's backend.
libogc2's historical lwIP calls the delayed-ACK helper when the application
returns receive-window space, which can hold a zero-window update until the
250 ms fast timer and cap a bulk response to only a few kilobytes per second.
The pinned backport ACKs consumed data immediately but advertises returned
space only after a complete receive window has drained. For the Dolphin TAP
harness it also limits that window to one MSS, preventing the emulator bridge
from handing two full Ethernet frames to the BBA concurrently. This trades
some theoretical bandwidth for deterministic delivery; it should be revisited
against a real BBA rather than assumed to be a hardware requirement. It matches
the long-standing [lwIP receive-performance
guidance](https://lists.nongnu.org/archive/html/lwip-users/2004-10/msg00022.html)
while respecting the BBA's small ring. The automated local HTTP playback run
now scans and caches the 155,648-byte test movie without the earlier
one-segment-per-second stalls, starts playback, decodes at about 30 fps, pauses
and resumes, and leaves a clean invalid-access log.

The managed runner defaults Dolphin to DSP LLE. Movie audio follows
WiiMC-GCN's `ao_gekko` design and streams decoded stereo PCM directly through
`AUDIO_InitDMA`, but the linked homebrew stack still caused Dolphin 2606 to
report unknown ucode CRC `8d527c50`. Dolphin's own homebrew-audio maintainer
documents that substituting AX for an unknown homebrew ucode is not correct and
recommends LLE for proper emulation. This affects only Dolphin; real hardware
runs the uploaded code on its DSP. `DOLPHIN_AUDIO_EMULATION=HLE` remains
available for diagnosis, while unknown-ucode/AX fallback remains a hard
log-check failure.

The linked decoder comes from MPlayer CE's historical FFmpeg tree. Its source
and license files remain in the pinned ignored checkout, and the bootstrap
rebuilds the static libraries. The console runtime is intentionally
GPL-3.0-or-later so it can directly use MPlayer CE's proven GX and codec work
and WiiMC-GCN's libwiigui navigation behavior. This does not change the
licensing of the separate Multiplex web application.

Large CPU-side buffers deliberately use ordinary `malloc`. During the raylib
experiment, large `memalign` calls returned corrupt pointers and produced
multiple Dolphin invalid reads and writes. Only the final GX texture view is
manually aligned within an over-allocated ordinary allocation. Both Native
buffers retain 64-byte canary regions. Native SDK's nested text rasterizer
also exceeds libogc2's 128 KiB main-thread stack, so the app/render loop runs
on a dedicated 512 KiB LWP stack. Dolphin's `MASTER` log channel is enabled,
and `gamecube:reference:log-check` fails on invalid accesses, guard
failures, or renderer failures.

## Acknowledgements

This app is built on, borrows from, and is inspired by a lot of open source
work:

- [Native SDK](https://github.com/vercel-labs/native) (`vercel-labs/native`):
  the UI framework. It owns the widget tree, layout, focus, text
  rasterization, and the reference renderer whose pixels the console
  presents, and it bundles the [Geist](https://vercel.com/font) typeface used
  throughout.
- [libogc2](https://github.com/extremscorner/libogc2): the GameCube/Wii
  runtime: threads, EXI/BBA drivers, GX and Audio Interface access, and its
  bundled [lwIP](https://savannah.nongnu.org/projects/lwip/) TCP/IP stack,
  to which we backport upstream lwIP fixes.
- [MPlayer CE](https://github.com/SuperrSonic/mplayer-ce-libogc2): the pinned
  GameCube-optimized FFmpeg tree, and the decoder-to-planar-YUV-to-GX TEV
  presentation architecture the media pipeline follows.
- [WiiMC-GCN](https://github.com/SuperrSonic/WiiMC-GCN): the `ao_gekko`
  Audio Interface DMA driver design and libwiigui's analog navigation
  behavior (libwiigui copyright Tantric 2009-2012).
- [Mbed TLS](https://github.com/Mbed-TLS/mbedtls): TLS for direct Plex and
  Multiplex HTTPS traffic.
- [curl](https://curl.se/docs/caextract.html): the pinned Mozilla CA
  certificate bundle.
- [devkitPro](https://devkitpro.org/): the pinned devkitPPC PowerPC
  cross-compilation toolchain.
- [Zig](https://ziglang.org): compiles the Native SDK core for PowerPC.
- [Meson](https://mesonbuild.com) and [Ninja](https://ninja-build.org): the
  portable native target graph, host tests, and compilation database.
- [Dolphin](https://dolphin-emu.org): the development and automation
  harness, including the low-level BBA emulation the network smokes drive.
- [passt/pasta](https://passt.top/): the rootless Ethernet uplink that
  connects Dolphin's TAP networking without host privileges.
- [OpenGX](https://github.com/devkitPro/opengx) and
  [raylib](https://github.com/raysan5/raylib) (via
  [raylib4Consoles](https://github.com/raylib4Consoles)): the experimental
  portable presenter path kept for future platforms.

See `docs/spikes/gamecube-native-sdk.md` for the original spike record and its
measurements, and `PROGRESS.md` for current hardware status.

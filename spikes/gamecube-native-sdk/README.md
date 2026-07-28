# GameCube Native SDK spike

This is a real GameCube DOL whose UI is authored in restricted TypeScript and
Native SDK `.native` markup. Native SDK builds the widget tree, resolves
handlers, performs layout, and rasterizes its reference output on PowerPC. A
small libogc2/GX host presents that completed RGBA frame without recreating UI
semantics.

## Run

From the repository root:

```sh
bun run spike:gamecube:bootstrap
bun run spike:gamecube:check
bun run spike:gamecube:reference:dol
bun run spike:gamecube:reference:run
bun run spike:gamecube:reference:log-check
bun run spike:gamecube:reference:smoke-player
bun run spike:gamecube:reference:smoke-http-tap
```

`spike:gamecube:reference:run` uses an isolated Dolphin profile and replaces
its previous recorded process, keeping one emulator instance open. The managed
profile exposes a component-capable output, so the presenter selects 640x480
progressive scan; composite-only hardware falls back to the preferred
interlaced mode.

`spike:gamecube:reference:smoke-http-tap` builds the DOL with a local HTTP
media URL, creates an unprivileged network namespace, and connects Dolphin's
low-level emulated BBA to a rootless `pasta` Ethernet uplink. It does not
modify the host's physical network and does not require sudo. The bootstrap
pins a `pasta` revision containing its June 2026 fix for padded minimum-size
IPv4 frames; older releases silently drop the GameCube TCP SYN.

The spike retains three separate artifacts:

- `multiplex-gamecube-native-reference.dol`: exact Native SDK reference pixels
  presented through direct GX; this is the recommended visual baseline.
- `multiplex-gamecube-spike.dol`: the earlier command-to-GX approximation.
- `multiplex-gamecube-raylib-reference.dol`: the portability experiment. Its
  framebuffer and texture uploads work, but raylib4Consoles/OpenGX currently
  fails to draw the textured quads correctly on the tested GameCube stack.

The controller profile attaches a standard controller to SI port 1 and is backed by
`.dolphin-user/Pipes/multiplex1`. Dolphin pipe commands such as `PRESS A`,
`RELEASE A`, and `PRESS D_RIGHT` drive the automated player smoke test.

## Source map

- `src/core.ts`: application model and update function
- `src/app.native`: declarative pairing, library, details, and player views
- `src/gamecube_probe.zig`: compiled view, layout, focus/handler resolution,
  GPU-packet translation, and C ABI
- `host-reference-gx/main.c`: reference framebuffer and direct-GX presenter
- `host-reference-gx/mpeg2_decoder.c`: narrow wrapper around MPlayer CE's
  bundled FFmpeg MPEG-2 decoder
- `host-reference-gx/mp2_decoder.c`: fixed-point MPlayer CE FFmpeg MP2 decoder
- `host-reference-gx/mpeg_ps_demux.c`: MPEG-2 Program Stream PES extraction
  and initial 90 kHz PTS preservation
- `host-reference-gx/audio_dma.c`: buffered Audio Interface DMA output adapted
  from WiiMC-GCN's `ao_gekko` driver
- `host-reference-gx/http_client.c`: libogc2/BBA HTTP byte-range downloader
- `host-reference-gx/yuv420_gx.c`: tiled planar-YUV upload and GX TEV
  conversion/scaling
- `scripts/smoke-dolphin-player.sh`: player navigation, animation,
  pause/resume, and invalid-access assertions
- `scripts/run-dolphin-rootless-tap.sh`: isolated TAP-to-`pasta` Ethernet
  harness for exercising Dolphin's low-level BBA emulation without sudo
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
ran without an underrun through the automated pause/resume flow. A blocking
libogc2 client can also download the same container from a directly playable
HTTP URL as 1 KiB byte ranges over one persistent connection. The rootless TAP
smoke transferred all 155,648 bytes, decoded and played them, completed the
same interaction/timing gates, and produced a clean memory log. Dolphin 2606's
BuiltIn HLE backend still stalls after its first responses; the passing TAP
control isolates that behavior to HLE rather than the app's BBA path.

The isolated Dolphin profile uses its normal DSP HLE mode. Movie audio follows
WiiMC-GCN's `ao_gekko` design and streams decoded stereo PCM directly through
`AUDIO_InitDMA`, so it does not upload a DSP mixer ucode. The earlier AESND
implementation required LLE only because Dolphin 2606 did not recognize the
current libogc2 yield/resume ucode. Removing that unnecessary mixer removes
the emulator-specific requirement; unknown-ucode/AX fallback remains a hard
log-check failure.

The linked decoder comes from MPlayer CE's historical FFmpeg tree. Its source
and license files remain in the pinned ignored checkout, and the bootstrap
rebuilds the static libraries. The console runtime is intentionally
GPL-2.0-or-later so it can directly use MPlayer CE's proven GX and codec work;
this does not change the licensing of the separate Multiplex web application.

Large CPU-side buffers deliberately use ordinary `malloc`. During the raylib
experiment, large `memalign` calls returned corrupt pointers and produced
multiple Dolphin invalid reads and writes. Only the final GX texture view is
manually aligned within an over-allocated ordinary allocation. Both Native
buffers retain 64-byte canary regions. Native SDK's nested text rasterizer
also exceeds libogc2's 128 KiB main-thread stack, so the app/render loop runs
on a dedicated 512 KiB LWP stack. Dolphin's `MASTER` log channel is enabled,
and `spike:gamecube:reference:log-check` fails on invalid accesses, guard
failures, or renderer failures.

See `docs/spikes/gamecube-native-sdk.md` for measurements and the next gate.

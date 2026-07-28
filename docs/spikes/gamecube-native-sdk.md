# Spike: Native SDK on GameCube

**Goal:** author a GameCube client with declarative `.native` markup and
restricted TypeScript state logic, while shipping only ahead-of-time PowerPC
code.

**Code:** `spikes/gamecube-native-sdk/`

**Upstream inputs:**

- [Vercel Native SDK](https://github.com/vercel-labs/native)
- [WiiMC-GCN](https://github.com/SuperrSonic/WiiMC-GCN)
- [MPlayer CE libogc2](https://github.com/SuperrSonic/mplayer-ce-libogc2)
- [libogc2](https://github.com/extremscorner/libogc2)

## Result

The architectural hypothesis is viable.

The current DOL boots in Dolphin and executes this path on the emulated Gekko:

```text
restricted TypeScript model
  -> generated Zig
  -> compiled .native view
  -> Native SDK layout and display list
  -> reference RGBA framebuffer
  -> small C ABI + Native SDK media-surface geometry
  -> MPEG-2 Program Stream PES/PTS demux
  -> MPlayer CE FFmpeg MPEG-2/MP2 decode
  -> tiled GX UI + planar-YUV TEV presentation + direct AI DMA audio
```

It is not a screenshot or a separately recreated C menu. `core.ts` owns the
model/update function, `app.native` owns the view and handlers, and Native SDK
performs the layout, text rasterization, rounded corners, strokes, shadows, and
compositing. The GX host only converts and presents the completed pixels.

Verified interactions:

- A activates the focused pairing handler and opens the library.
- D-pad changes Native SDK focus between Previous, Open, and Next.
- A on Open shows the details view.
- Play opens a Native SDK `<video>` player surface.
- A pauses/resumes DVD-resolution MPEG-2 video and stereo MP2 audio; B unwinds
  player → details → library.

## Reproduce

Requirements are Zig 0.16.0, Node/npm for Native SDK's build-time compiler,
Podman, and Dolphin.

```sh
bun run spike:gamecube:bootstrap
bun run spike:gamecube:check
bun run spike:gamecube:reference:dol
bun run spike:gamecube:reference:run
bun run spike:gamecube:reference:log-check
bun run spike:gamecube:reference:smoke-player
```

The build pins Native SDK commit
`a7509a7fa6c467eaed021250538b482886f1c6bf`, MPlayer CE/libogc2 commit
`b070e11903f5c0eee02fe3577a1aa8856c71af81`, and the devkitPPC container by
digest. It builds MPlayer CE's bundled FFmpeg libraries without patching the
upstream checkout and emits:

```text
spikes/gamecube-native-sdk/multiplex-gamecube-native-reference.dol
```

The launcher uses an isolated Dolphin profile and records the exact process
ID. Starting it again terminates that instance before launching the new DOL, so
iteration leaves one Dolphin process rather than accumulating emulator windows.
The profile enables Dolphin's component-capable output and the presenter
selects the matching progressive mode. This avoids the alternating-field
vertical jitter of 480i; composite-only hardware keeps the preferred
interlaced fallback.

The profile uses Dolphin's normal DSP HLE mode. WiiMC-GCN's working
`ao_gekko` path showed that stereo movie output does not need ASND or AESND:
it can hand decoded PCM straight to the GameCube Audio Interface with
`AUDIO_InitDMA`. The spike now follows that design and does not upload a DSP
mixer ucode. The previous LLE profile was valid for its AESND implementation,
but the requirement was self-inflicted: Dolphin 2606 did not recognize that
libogc2 revision's yield/resume ucode and fell back to AX under HLE. Direct AI
DMA removes the mismatch, and the smoke test still rejects unknown-ucode/AX
fallback warnings.

## Native SDK patches

The bootstrap applies two narrow patches to its ignored, pinned Native SDK
clone. The portability patch:

- the text-measure generation counter is non-atomic for a single-threaded
  target;
- `LazyTls` uses static storage instead of a page allocator when the target is
  single-threaded.

This removes two desktop assumptions without adding GameCube branches to
Native SDK's renderer. The renderer patch adds platform-neutral,
byte-preserving fast paths:

- rounded fills evaluate exact signed-distance coverage only along each row's
  short edge ramps, then blend the full-coverage interior as a span;
- rounded strokes skip the broad area where both inner and outer coverage are
  one and their difference is zero;
- shadows prepare normalized geometry once per command and reuse the exact
  source-over result across identical destination pixels inside the shape.
- square-cornered rounded-fill commands, including media placeholders, blend
  their contiguous interior as a span instead of rechecking every pixel.

The general algorithms stay in Native SDK's reference renderer; the GameCube
adapter contains no visual approximation or console-specific primitive.

## Renderer comparison

Three presenters remain side-by-side:

- The original command-to-GX adapter is small and fast, but approximates
  rounded corners, typography, strokes, gradients, and effects.
- The pinned raylib4Consoles/OpenGX adapter accepts the reference pixels and
  uploads all sixteen texture tiles, but its GameCube primitive path does not
  render those quads correctly in the tested revision.
- The direct-GX reference presenter displays those same sixteen tiles
  correctly and is the current visual-parity baseline.

Raylib remains strategically interesting as a portable API, especially for
Dreamcast and PS2, but the current GameCube backend is not a usable foundation
without fixing its OpenGX primitive path.

### Typography

The reference presenter uses Native SDK's own bundled Geist assets and
reference text pipeline. GX does not rerasterize or reinterpret text, so the
small copy and the top-right badge match the SDK output rather than the older
four-size atlas approximation.

### Media surface

The player view is authored with Native SDK's real `<video>` element. During
layout, the Zig adapter locates its `media_surface` widget and exports the
resolved rectangle and TypeScript-owned play state through the C ABI.

The DOL embeds a one-second MPEG-2 Program Stream containing 720x480 YUV420P
video at 30000/1001 fps and 192 kbps MP2 audio. A narrow incremental demuxer
walks MPEG-2 pack and PES headers, selects the first MPEG video (`0xE0`) and
audio (`0xC0`) streams, feeds bounded codec queues, and preserves their first
90 kHz PTS values. The generated stream starts audio at `47101`
and video at `48003`: a 902-tick or 10.022 ms delta, rounded to 481 samples at
48 kHz. The scheduler applies that offset once when it establishes the audio
clock epoch.

A narrow wrapper registers only the pinned MPlayer CE FFmpeg MPEG-2 decoder
and emits display-order planar frames. A lower-priority LWP copies Y, U, and V
directly into two sets of GX I8 textures. The GX TEV stages perform
limited-range BT.601 YUV-to-RGB conversion and scale the result into Native
SDK's resolved media rectangle. This is the same fundamental
decoder-to-planar-YUV-to-GX architecture used by MPlayer CE; unlike the
discarded NanoJPEG experiment, it has no CPU-side RGB conversion or
low-resolution intermediate.

MPlayer CE's fixed-point FFmpeg MP2 decoder fills 48 kHz, stereo,
native-endian S16 PCM on a second producer LWP. Eighteen aligned 5,760-byte
buffers feed a direct Audio Interface DMA path adapted from WiiMC-GCN's
`ao_gekko` driver. The interrupt-side callback distinguishes the block
currently being read from the one already queued in the hardware's second
slot, and the decoder only claims free buffers. The callback never blocks on
UI or video work, and the tested flow reports zero underruns.

The view/focus behavior, media geometry, and play state remain Native
SDK-owned. Decode is independent of UI rerenders; pause holds the last YUV
textures and freezes Audio Interface DMA, then resume continues both pipelines. The
automated smoke traverses pairing → home → details → player, waits for a
60-frame decoder profile, verifies neither video nor audio advances during a
five-second pause, resumes, and runs the invalid-access and DSP-ucode gates.

The embedded clip is generated test material rather than an encrypted DVD
image. Optical-disc filesystem, CSS, additional stream selection, and
subtitles remain separate layers; the spike now proves the container,
timestamp, video/audio codec, output, and shared-clock boundaries at DVD media
parameters.

### HTTP and BBA

The same media pipeline can source its program stream from a directly
playable HTTP URL. A small blocking libogc2 client initializes the BBA with
DHCP, validates `206`, `Content-Length`, and `Content-Range`, and exposes a
seekable 1 KiB range cache for metadata inspection. Playback then changes to a
single forward-only HTTP GET owned by a producer LWP. The demux feeds a fixed
320 KiB video queue and 64 KiB audio queue; the MPEG-2 and MP2 adapters retain
only 32 KiB and 8 KiB compressed input windows. Container-sized and
elementary-stream-sized allocations are gone. The full player smoke exercises
the same demux, decode, audio, navigation, pause/resume, timing, and
invalid-access gates as the embedded build.

The Plex runner now starts a persistent, versioned Multiplex console gateway
instead of exposing a bare fixture file. `GET /v1/catalog.bin` is a bounded,
big-endian contract designed to be parsed without JSON or heap allocation on
the console:

```text
"MPXG" | u16 version | u16 item count | u16 server bytes | u16 reserved
server UTF-8 bytes
repeated item count times:
  u32 rating key | u32 duration ms | u32 view offset ms |
  u16 title bytes | u16 flags | title UTF-8 bytes
```

Version 1 limits the snapshot to four items, 63 server-name bytes, 95 title
bytes, and a 1 KiB response. The GameCube fetches it through the same BBA HTTP
client, validates every length and version, stores it in fixed C buffers, and
dispatches server/item messages into the TypeScript-authored model before the
first Native SDK render. `/v1/health` supports host orchestration and
`/v1/media/current.mpg` serves the prepared MPEG-2/MP2 stream with byte ranges.
The demonstrated screen is therefore driven by the real Plex server name and
recent titles rather than the previous static demo catalog.

For gateway-prepared media, the host supplies selected stream sizes and first
PTS in the generated build header. This avoids scanning an entire multi-MiB
file through 1 KiB BBA ranges. The first real Plex run discovered PMS
1.43.3 on the LAN, downloaded a segment of a library movie, and converted it
to a 3,743,744-byte 720x480 MPEG-2/MP2 program stream. Dolphin needed one
metadata range request before the sequential GET. It decoded two measured
60-frame intervals at 29.9 fps, presented retained frames at 60.4 fps, paused
and resumed on the AI DMA clock with zero underruns, and passed the invalid
read/write gate. The repeatable runner keeps Dolphin muted at the PipeWire
sink-input layer without muting the emulated application.

The low-level control uses Dolphin's TAP BBA inside an unprivileged network
namespace. A pinned `pasta` process supplies DHCP and rootless host networking;
the harness translates only the outer Ethernet source/destination MAC at its
bridge boundary, leaving the GameCube's ARP, IP, and TCP payloads unchanged.
No sudo or physical-interface reconfiguration is required. The host's packaged
June 11, 2026 `pasta` silently discarded the GameCube's padded 60-byte TCP SYN;
upstream commit `f072bc0` fixed that exact class of frame on June 16 and is
pinned by the spike bootstrap.

With the fixed helper, Dolphin's TAP backend completes the clean playback
smokes. Dolphin 2606's BuiltIn HLE backend can serve the
first responses but stalls under the repeated transfer. The passing TAP test
therefore demonstrates that the app/libogc2 BBA path works and isolates the
remaining failure to Dolphin's BuiltIn HLE translation, not to a requirement
that would affect a physical GameCube BBA.

## Invalid-access investigation

Dolphin reported multiple invalid reads and writes during the raylib/OpenGX
work. They were real:

- one write resolved to Zig's weak `memcpy`, but that was only the final store;
- another resolved to libogc2 `dlmalloc`;
- another resolved to OpenGX's `TexelRGBA8::store`;
- OpenGX then logged an impossible pointer returned by a large `memalign`.

The Native reference renderer's 64-byte guards stayed intact after every pass.
Replacing large aligned CPU allocations with ordinary `malloc` eliminated the
faults. The direct-GX presenter over-allocates its final texture storage by 31
bytes and aligns only the view passed to GX.

A second invalid-access source surfaced when interaction rerenders were first
exercised. libogc2 reserves a 128 KiB stack for its main thread, while Native
SDK's exact text path nests its glyph builder, antialiased scanline storage,
and surrounding render frames deeply enough to exceed that reservation. The
stack grew into adjacent Zig BSS, changing live app state after the first text
command and producing Dolphin read/write warnings. The host now keeps `main`
small and runs the app/render loop on a dedicated 512 KiB LWP stack allocated
with ordinary `malloc`.

The final Dolphin run has one window, a deterministic pairing pixel signature
for each catalog payload, and no invalid read/write entry in the current-run log. Dolphin's
`MASTER` channel is enabled so CPU/MMU warnings are written rather than only
shown in dialogs; `spike:gamecube:reference:log-check` rejects invalid reads,
invalid writes, buffer-guard failures, and renderer failures. The presenter
uses two XFBs and a `0..639` by `0..479` pixel-center projection; the latter
also eliminates the previously untouched green row at the top of the EFB.

## Measured posture

The current build is approximately:

| Property                       | Current result                                |
| ------------------------------ | --------------------------------------------- |
| Reference DOL                  | 1.63 MiB                                      |
| ELF target                     | 32-bit, big-endian PowerPC, statically linked |
| ELF text / data / BSS          | 846 KiB / 549 KiB / 5.25 MiB                  |
| TypeScript runtime reservation | 128 KiB frame + two 256 KiB model heaps       |
| App/render thread stack        | 512 KiB, dynamically allocated                |
| Video decoder thread stack     | 256 KiB, dynamically allocated                |
| Audio decoder thread stack     | 128 KiB, dynamically allocated                |
| Network/demux producer stack   | 128 KiB, dynamically allocated                |
| Compressed video/audio queues  | 320 KiB / 64 KiB                              |
| Codec compressed input windows | 32 KiB / 8 KiB                                |
| Pairing view                   | 10 widgets, 1 handler                         |
| Home view                      | 17 widgets, 3 handlers, 17 layout nodes       |
| Embedded MPEG-2 Program Stream | 720x480 video + stereo MP2 / 152 KiB          |
| Extracted MPEG-2 payload       | 720x480 YUV420P / 125 KiB                     |
| Extracted MP2 payload          | 48 kHz stereo, 192 kbps / 24 KiB              |
| Audio Interface DMA pool       | 18 x 5,760-byte aligned PCM buffers           |
| Double-buffered YUV textures   | 720x480 + 2x360x240 / 1,012.5 KiB             |

The ELF footprint excludes the two XFB framebuffers and libogc/runtime dynamic
allocations. The memory result is acceptable for a proof, but it is too early
to approve alongside artwork, networking, audio, and video decode.

The Native reference path now renders exactly once per state change; the
former three-pass convergence loop produced identical signatures and only
tripled startup latency. The three remaining cold hotspots were the large
panel's shadow, rounded fill, and rounded stroke. Exact scanline/solid-blend
fast paths reduced the 11-command pairing view from about 0.55 to 0.326
seconds, the 24-command cold home view from 7.13 to 0.490 seconds, and cold
details from 8.02 to 0.453 seconds. This is a 93–94% reduction for the two
large screens. Native SDK's host tests also pass, and focus-only home changes
render in about 0.068 seconds. Pixel signatures are content-dependent now that
the gateway supplies the server and title strings, so the interaction smokes
gate on each newly rendered frame plus semantic media state instead of one
hard-coded demo-library hash.

The renderer also attaches Native SDK's exact `ReferenceRenderMemo` through a
GameCube allocator with a 4 MiB hard ceiling. The allocator uses ordinary
`malloc`, aligns returned views without `memalign`, and accounts every live
memo byte. In the exercised pairing → home → details flow, three expensive
commands populated 1,893 KiB for home and the combined cache peaked at
4,093 KiB. With the fast paths, a subsequent full home repaint hit all three
entries and rendered in 0.373 seconds; revisiting details likewise hit three
entries and rendered in 0.328 seconds. Repeated command-state signatures stay
stable across cold and warm renders.

RGBA-to-tiled-GX conversion remains about 10.3 ms per changed UI frame. Idle
frames do not rerender; in NTSC 480p the guest measured 120 paused
presentations in 1,985,316 microseconds, or 60.4 progressive frames per
second. For the current DVD-resolution clip, steady 60-frame profiles measured
29.7–30.2 decoded frames per second around the 29.97 fps target. Audio
Interface DMA callbacks advance completed 1,440-sample PCM bursts after the
hardware's initial request for its second buffer, and the clock interpolates
within the current burst; video requests derive directly from that sample
position rather than an independent wall clock. The initial program-stream
PTS delta delays the first video target by 481 audio samples. MPlayer CE's
fast MPEG-2 intra
path is enabled. Codec work averaged 6.7 ms with a 33.7 ms maximum; planar
tiled upload averaged 1.5 ms. Long MPEG I-frames can miss a VBlank, after which
the audio clock immediately schedules a catch-up decode; presentation returns
to 60.4 fps rather than permanently slowing the media clock. The square-fill
fast path keeps player UI state rerenders near 0.275 seconds. Two Dolphin
window captures taken a second apart while paused were byte-identical.

The same smoke run decoded MP2 continuously into direct Audio Interface DMA
with zero buffer underruns. Its sample counter was unchanged across the
five-second pause and resumed from the exact logged count. Repeated Dolphin
DSP HLE runs completed the full flow without loading a DSP ucode, falling back
to AX, reporting an invalid access, or missing the timing gate.

The console spike is intentionally GPL-2.0-or-later so it can directly reuse
MPlayer CE's proven GameCube work. Native SDK remains Apache-2.0 and the
bundled FFmpeg subset is LGPL-2.1-or-later; their notices and source remain in
the pinned checkouts. This console-specific choice does not relicense the
separate Multiplex web application.

## Decision

Continue with Native SDK for the GameCube prototype. Keep the direct GX
presenter as the parity oracle and treat raylib as a portability experiment,
not as the committed GameCube renderer yet.

Next Dolphin milestones:

1. add artwork and the web app's Continue Watching/recent hub structure to the
   catalog contract and controller navigation;
2. turn the host-prepared Plex segment into an on-demand, seekable full-item
   session with progress persistence;
3. add player controls and Watch Together state through the same gateway;
4. decide whether to repair raylib/OpenGX or extract a smaller portable
   framebuffer/presenter interface before the Dreamcast pass.

Hardware profiling remains deferred until the Dolphin app is materially
useful; it is not a gate on these milestones.

The Wii fast-follow should share the TypeScript, markup, Native SDK adapter,
and most GX code. Platform differences should stay in video mode, input,
networking, memory budgets, and the media host.

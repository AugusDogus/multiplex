# Spike: Native SDK on GameCube

**Goal:** author a GameCube client with declarative `.native` markup and
restricted TypeScript state logic, while shipping only ahead-of-time PowerPC
code.

**Code:** `apps/gamecube/` (promoted from `spikes/gamecube-native-sdk/` once
the hypothesis was proven; this document remains the historical spike record)

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
  -> versioned Plex home, search, and paged-library data + JPEG artwork atlases
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
- Z opens Search; a three-row on-screen keyboard authors a query with the
  D-pad/A, L deletes, and R submits it to the real Plex server.
- Y opens the real Plex library picker; D-pad and A select a library.
- D-pad changes Native SDK focus and L/R page four library items at a time.
- A on a home, search, or browse poster fetches and renders its full Plex
  metadata, including resume state and a context-sensitive play action.
- Play opens a Native SDK `<video>` player surface.
- A pauses/resumes DVD-resolution MPEG-2 video and stereo MP2 audio; B unwinds
  player → details → library.

## Reproduce

Requirements are Zig 0.16.0, Node/npm for Native SDK's build-time compiler,
Podman, and Dolphin.

```sh
bun run gamecube:bootstrap
bun run gamecube:check
bun run gamecube:reference:dol
bun run gamecube:reference:run
bun run gamecube:reference:log-check
bun run gamecube:reference:smoke-player
```

The build pins Native SDK commit
`a7509a7fa6c467eaed021250538b482886f1c6bf`, MPlayer CE/libogc2 commit
`b070e11903f5c0eee02fe3577a1aa8856c71af81`, and the devkitPPC container by
digest. It builds MPlayer CE's bundled FFmpeg libraries without patching the
upstream checkout and emits:

```text
apps/gamecube/multiplex-gamecube-native-reference.dol
```

The launcher uses an isolated Dolphin profile and records the exact process
ID. Starting it again terminates that instance before launching the new DOL, so
iteration leaves one Dolphin process rather than accumulating emulator windows.
Commands launched from T3 Code inherit Linux `SCHED_IDLE`; passing that policy
to Dolphin made roughly two seconds of guest time take about one minute of wall
time even though the in-guest profiler still reported 60.4 fps. The launcher
now detects that case and uses a transient `systemd --user` service with
`SCHED_OTHER`. It needs no sudo, leaves ordinary terminal launches alone, and
stops the service when the launcher is interrupted, without showing Dolphin's
confirmation dialog. Under normal scheduling, the embedded player reached its
first 60-frame decode report in about 2.5 seconds of wall time and then
sustained 29.9–30.2 decoded fps with zero audio underruns.
Because Dolphin gives raw GameCube cards regional filenames even for a
region-free DOL, the isolated profiles explicitly pin the fallback region to
North America. This keeps the app on `MemoryCardA.USA.raw`; otherwise a locale
or profile change can make a valid Multiplex save appear to disappear by
silently selecting another regional card image.
The profile enables Dolphin's component-capable output and the presenter
selects the matching progressive mode. This avoids the alternating-field
vertical jitter of 480i; composite-only hardware keeps the preferred
interlaced fallback.

WiiMC-GCN's working `ao_gekko` path showed that stereo movie output does not
need ASND or AESND: it can hand decoded PCM straight to the GameCube Audio
Interface with `AUDIO_InitDMA`. The spike follows that design. Even so, the
linked homebrew stack caused Dolphin 2606 to report unknown ucode CRC
`8d527c50`. Dolphin PR
[#10793](https://github.com/dolphin-emu/dolphin/pull/10793#issuecomment-1170318021)
documents that its AX fallback does not correctly emulate unknown homebrew
ucode and says to use DSP LLE. The managed runner therefore defaults to LLE,
with `DOLPHIN_AUDIO_EMULATION=HLE` as a diagnostic override. This is an
emulator profile requirement only; real hardware executes the uploaded DSP
code. The smoke test continues to reject unknown-ucode/AX fallback warnings.

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
seekable 4 KiB range cache for metadata inspection. Playback then changes to a
single forward-only HTTP GET owned by a producer LWP. The demux feeds a fixed
320 KiB video queue and 64 KiB audio queue; the MPEG-2 and MP2 adapters retain
only 32 KiB and 8 KiB compressed input windows. Container-sized and
elementary-stream-sized allocations are gone. The full player smoke exercises
the same demux, decode, audio, navigation, pause/resume, timing, and
invalid-access gates as the embedded build.

The Plex runner now starts a persistent, versioned Multiplex console gateway
instead of exposing a bare fixture file. `GET /v2/catalog.bin` is a bounded,
big-endian contract designed to be parsed without JSON or unbounded allocation
on the console:

```text
"MPXG" | u16 version | u16 row count | u16 server bytes | u16 reserved
server UTF-8 bytes
repeated row count times:
  u16 row-title bytes | u16 item count | row-title UTF-8 bytes
  repeated item count times:
    u32 rating key | u32 duration ms | u32 view offset ms |
    u16 artwork slot | u8 progress percent | u8 flags |
    u16 title bytes | u16 subtitle bytes | title/subtitle UTF-8 bytes
```

Version 2 limits the home snapshot to three rows of four items, 63 server-name
bytes, and 95 bytes per label. The gateway applies the web home ordering:
Continue Watching first, excludes duplicate On Deck content, then adds recent
browsable hubs. The GameCube fetches it through the same BBA HTTP client,
validates every length and version, stores it in fixed C buffers, and dispatches
row/item messages into the TypeScript-authored model before the first Native
SDK render. `/v1/health` supports host orchestration and
`/v1/media/current.mpg` serves the prepared MPEG-2/MP2 stream with byte ranges.
The demonstrated screen is therefore driven by the real Plex server name,
Continue Watching state, recent titles, episode subtitles, and progress rather
than the previous static demo catalog.

Version 3 preserves that complete v2 prefix, uses the formerly reserved header
field as a library count, and appends the real Plex library sections:

```text
repeated library count times:
  u16 section id | u8 media type | u8 reserved |
  u16 title bytes | title UTF-8 bytes
```

Paged browsing uses a separate bounded response at
`GET /v3/browse.bin?section=S&start=N`:

```text
"MPXB" | u16 version | u16 section id | u16 item count |
u16 start | u16 total | u16 library-title bytes | title UTF-8 bytes
repeated item count times: the same bounded v2 item record
```

The gateway queries Plex's `/library/sections/{id}/all` endpoint in
title-sort order and caps each page at four items. Its paired
`/v3/browse.jpg` contact sheet is 320x120, so the existing JPEG decoder and
four fixed browse texture slots are reused. The TypeScript model owns the
Libraries and Browse screens, paging state, details origin, and Back behavior;
the C boundary only validates/fetches the requested page and stages it into
that model. The real-server run discovered Movies, Anime, TV Shows, and
Audiobooks, opened Movies (785 items), rendered pages starting at 0 and 4,
then returned through Libraries to Home. R/L expose direct page actions for
normal console navigation and deterministic Dolphin automation.

Search uses `GET /v3/search.bin?q=Q`, another fixed-boundary response:

```text
"MPXS" | u16 version | u16 item count | u16 query bytes | query UTF-8 bytes
repeated item count times: the same bounded v2 item record
```

The gateway queries Plex `/library/search` across movie, TV, music, people,
and collections, retains Plex relevance order, and caps the GameCube result
grid at four metadata-addressable entries. Person tag records are excluded
until the console has a dedicated person-results view because their numeric
tag ids are not Plex metadata rating keys. `/v3/search.jpg` reuses the 320x120
four-poster contact sheet and the browse texture slots. The TypeScript model
owns query editing, loading/results/empty states, and the details return origin. The automated
Dolphin route typed `FRESH` entirely through the emulated controller, loaded
four real results and posters, opened the top result, and returned through
Results and Search to Home before continuing into paged browsing and playback.

Opening a metadata-addressable card requests
`GET /v3/details.bin?ratingKey=K`. Its bounded `MPXD` payload carries the
rating key, duration, view offset, year, rating, playable flag, and length-
prefixed title, secondary title, media type, library, content rating, synopsis,
genres, and directors. The largest synopsis is 383 UTF-8 bytes and the entire
response remains below the existing 2 KiB console buffer. The GameCube owns
persistent copies of every returned string before the Native SDK model is
updated; this avoids retaining slices into a reclaimed C request stack. The
verified `Fresh` view renders its poster, Movie/Movies/R badges, tagline,
`2022 | 114 min | Rating 8.2/10`, director, genres, wrapped synopsis, resume
state, and Play/Return actions. Unavailable metadata fails closed to a
non-playable result view rather than accidentally opening an unrelated numeric
tag id.

`GET /v2/artwork.jpg` serves the twelve possible posters as one 320x360 JPEG
contact sheet. The host downsizes and letterboxes Plex artwork into 80x120
cells. The GameCube registers only MPlayer CE FFmpeg's MJPEG decoder, decodes
the sheet as planar YUV420, converts each cell directly to `GX_TF_RGB565` 4x4
texture order, and overlays the textures at the exact Native SDK-resolved
`<image>` rectangles. In the real-server run, eleven raw RGB565 posters would
have required 211 KiB; the JPEG was 33,200 bytes and decoded all eleven cells
in 35 ms. The original 16 KiB-range stall was a transport bug rather than a
BBA limit: the corrected rootless path transferred a 35,151-byte artwork
response in single-digit milliseconds.

Gateway-prepared media is no longer coupled into the generated build header.
At startup the GameCube requests `GET /v4/playback.bin`:

```text
"MPXP" | u16 version | u16 flags | u32 rating key |
u32 container/video/audio bytes | u32 video/audio packet counts |
i64 first video/audio PTS90k | u16 media-path bytes | media path
```

The guest validates the bounded manifest, resolves its media path against the
gateway URL, and uses the supplied stream sizes and first PTS without scanning
an entire multi-MiB file through 4 KiB BBA ranges. Embedded and direct-URL
smokes retain separate fallbacks, while a gateway build fails closed when its
manifest is unavailable. The passing DOL contained none of the Plex media URL,
sizes, packet counts, or timestamps. The real Plex run discovered PMS
1.43.3 on the LAN, loaded three home hubs with eleven items, downloaded a
segment of `Fresh`, and converted it to a 15,597,568-byte 720x480 MPEG-2/MP2
program stream. Dolphin needed one
metadata range request before the sequential GET. It decoded two measured
60-frame intervals at 29.9 fps, presented retained frames at 60.4 fps, paused
and resumed on the AI DMA clock with zero underruns, and passed the invalid
read/write gate. The repeatable runner keeps Dolphin muted at the PipeWire
sink-input layer without muting the emulated application.

The same runner has a fully direct mode:

```sh
PLEX_BASE_URL=http://192.168.86.245:32400 \
MULTIPLEX_BASE_URL=https://multiplex.localhost \
GAMECUBE_DIRECT_PLEX=1 \
bun run gamecube:reference:plex
```

That mode starts no console gateway and prepares no host-side media file. The
GameCube restores its Plex server token and client identifier from the
Multiplex memory-card save, loads catalog/search/details and artwork directly
from PMS, creates the universal-transcoder HLS session, parses the full bounded
media playlist, and incrementally demuxes MPEG-TS into H.264/AAC queues. Plex
selected 480x270 at 576 kbps for the current 700 kbps ceiling; Dolphin sustained
the 24 fps source predominantly at 23.7–24.5 decoded fps and 60.4 presentation
fps through seek, pause/resume, eight 8-second segments, about 2,100 audio DMA
buffers, and direct `/:/timeline` reports with zero audio underruns and a clean
invalid-access log. Media bodies use a separate TCP transaction from serialized
control requests, preventing a paused full codec queue from blocking its own
timeline report.

The HLS request profile is build-time configurable for reproducible quality
experiments. At `GAMECUBE_PLEX_VIDEO_RESOLUTION=640x360` and
`GAMECUBE_PLEX_MAX_VIDEO_BITRATE=1000`, PMS selected a 640x360, 822 kbps
H.264/AAC variant. Direct playback now clears obsolete browse/details
reference-render memo entries before H.264 allocates reference pictures,
recovering 3.8 MiB on the first transition and 589 KiB on the seek transition.
That removed the 360p allocation failure. A short end-to-end sample completed
60 frames at 24.2 decoded fps, but a longer observation exposed the true
limit: complex scenes fell to 17 fps and eventually starved audio. The runner's
post-resume gate is now 45 seconds so that delayed failure is reproducible.
The 480x270/700 profile above is the highest sustained profile validated so far
and is now the conservative default.

Play is also gated by selection identity now. The TypeScript model enters a
preparing state and exposes the selected rating key through the native ABI.
The host requests `/v4/playback.bin?ratingKey=K`; the gateway returns 404 for a
different prepared item, the C parser independently verifies the manifest key,
and only an exact match commits the model to a visible/playing video surface.
The Dolphin route proved both the startup manifest and a second selected-key
request for `416284` before audio/video started. A different key currently
fails closed back to details; replacing that deliberate boundary with an
on-demand transcode and media-session swap is the next increment.

The low-level control uses Dolphin's TAP BBA inside an unprivileged network
namespace. A pinned `pasta` process supplies DHCP and rootless host networking;
the harness translates only the outer Ethernet source/destination MAC at its
bridge boundary, leaving the GameCube's ARP, IP, and TCP payloads unchanged.
No sudo or physical-interface reconfiguration is required. The host's packaged
June 11, 2026 `pasta` silently discarded the GameCube's padded 60-byte TCP SYN.
The bootstrap now pins July 28 upstream commit `f8df3f1`, which contains the
June padded-frame fix and the December 2025 throughput work for non-local
peers.

Packet captures isolated two additional compatibility bugs. Libogc2 carries a
2006-era lwIP TCP stack that moves `snd_nxt` backward during retransmission,
causing later ACKs to use the request's 380-byte-old sequence number. The
bootstrap backports lwIP upstream commit `c232edb`, which made `snd_nxt`
monotonic and RFC-correct. Pasta also returned immediately after receiving a
single final handshake ACK even when that same segment carried the first HTTP
request. A narrow patch retains the pure-ACK fast path but lets a data-bearing
ACK continue into established-state processing. This matches pasta's earlier
upstream first-ACK fixes without disabling its congestion-window or
delivery-rate controls.

With both fixes, the rootless run loads the catalog immediately, transfers a
35,151-byte artwork response in single-digit milliseconds, completes a
Portless TLS connection in about 0.19 seconds, and finishes the authenticated
tRPC request in about 0.44 seconds. The old workaround that inflated the
advertised TCP window, disabled delivery-rate feedback, forced window scaling
off, and slept after TAP frames has been removed. Those changes fought pasta's
flow control and increased retransmissions instead of fixing the packet-state
errors.

The libogc2 TCP receive-window expansion was removed as well. Packet capture
showed why upstream deliberately advertises only `2 * TCP_MSS`: the BBA receive
ring from page `0x01` through `0x10` can hold roughly two maximum-size Ethernet
frames. Advertising four frames let the peer overflow that hardware ring,
which produced duplicate ACKs, zero-window recovery, and retransmission
avalanches in `pasta`. Returning to upstream's two-segment window reduced the
real 93,863-byte Plex catalog transfer from about 19.2 seconds to 0.93 seconds
and reduced its captured retransmissions from 137 to 10. The rootless launcher
also supports `GAMECUBE_PASTA_CAPTURE=1` for packet capture without the
timing distortion of trace logging.

With the fixed helper, Dolphin's TAP backend completes metadata, artwork, TLS,
and tRPC control transfers and has carried the real Plex playback stream.
Dolphin 2606's BuiltIn HLE backend can serve the first responses but stalls
under the repeated transfer. The TAP results demonstrate that the app/libogc2
BBA path works and isolate that HLE failure from requirements that would affect
a physical GameCube BBA. The managed 155 KiB fixture smoke remains
timing-sensitive: one non-traced run timed out during its range scan, while a
traced rerun transferred the complete file and entered playback before trace
overhead prevented the 60-frame decoder assertion.

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
shown in dialogs; `gamecube:reference:log-check` rejects invalid reads,
invalid writes, buffer-guard failures, and renderer failures. The presenter
uses two XFBs and a `0..639` by `0..479` pixel-center projection; the latter
also eliminates the previously untouched green row at the top of the EFB.

## Measured posture

The current build is approximately:

| Property                       | Current result                                |
| ------------------------------ | --------------------------------------------- |
| Reference DOL                  | 1.65 MiB                                      |
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
| Home snapshot                  | Up to 3 rows x 4 real Plex items              |
| Search result page             | 4 relevance-ordered real Plex items           |
| Item details response          | Bounded metadata and synopsis below 2 KiB     |
| Library browse page            | 4 of up to 65,535 real Plex items             |
| Poster textures                | 12 home + 4 browse x 80x120 RGB565 / 300 KiB  |
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
five-second pause and resumed from the exact logged count. A normal-priority
Dolphin DSP LLE run completed the full flow without reporting an invalid
access or missing the timing gate.

The console spike is intentionally GPL-3.0-or-later so it can directly reuse
MPlayer CE's proven GameCube work and WiiMC-GCN's libwiigui navigation
behavior. Native SDK remains Apache-2.0 and the bundled FFmpeg subset is
LGPL-2.1-or-later; their notices and source remain in the pinned checkouts.
This console-specific choice does not relicense the separate Multiplex web
application.

## Decision

Continue with Native SDK for the GameCube prototype. Keep the direct GX
presenter as the parity oracle. Do not make raylib a dependency of the console
ports: a small platform-neutral module now owns the guarded 640x480 RGBA frame,
Native SDK render call, memo counters, and deterministic signature. Both the GX
and experimental raylib presenters compile against that boundary. Its host unit
test covers size rejection, initialization, rerendering, guard corruption, and
empty-render failures. The direct-GX Dolphin playback smoke remained at 60 fps
with stable audio pause/resume and a clean invalid-access log after extraction.

Next GameCube parity milestones:

1. label the minimal subtitle selector's individual tracks;
2. close the remaining web details gaps such as watched state and playlists.

Completed: bounded episode advance now crosses seasons and rotates Watch
Together clients into a matching next room without closing the player. The
player can also cycle Plex's indexed subtitle tracks and Off; selected tracks
render through Plex burn-in and survive seeks.

The initial Wii tracer bullet now builds a 3,081,460-byte DOL from the same
TypeScript, markup, PowerPC core, validated frame, GX presenter, and embedded
media pipeline. The only transport change was excluding libogc2's
GameCube-only `net_flush` extension when compiling against Wii's native IOS
network stack. Dolphin detected the Wii executable, rendered at 60.4 fps, and
passed the shared navigation, timestamped MPEG-2/MP2 playback, audio
pause/resume, and invalid-access smoke using an emulated Wii Remote pipe. The
host also maps a Classic Controller naturally and retains GameCube pad support.

Hardware profiling remains deferred until the Dolphin app is materially
useful; it is not a gate on these milestones.

Wii and Dreamcast remain fast-follow ports, but further port work is paused
until the GameCube client reaches the web application's core playback parity.

The Wii fast-follow should share the TypeScript, markup, Native SDK adapter,
and most GX code. Platform differences should stay in video mode, input,
networking, memory budgets, and the media host.

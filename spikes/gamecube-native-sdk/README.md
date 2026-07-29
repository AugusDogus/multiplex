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
bun run spike:gamecube:reference:plex
```

`spike:gamecube:reference:run` uses an isolated Dolphin profile and replaces
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

When `MULTIPLEX_BASE_URL` is an HTTPS `*.localhost` origin, the reference build
automatically embeds the public Portless CA from `~/.portless/ca.pem`.
`GAMECUBE_TLS_CA_FILE` remains the explicit override for another local CA. The
private key and generated host certificates are never copied into the build.

`spike:gamecube:reference:smoke-http-tap` builds the DOL with a local HTTP
media URL, creates an unprivileged network namespace, and connects Dolphin's
low-level emulated BBA to a rootless `pasta` Ethernet uplink. It does not
modify the host's physical network and does not require sudo. The bootstrap
pins a `pasta` revision containing its June 2026 fix for padded minimum-size
IPv4 frames and its December 2025 non-local-throughput work. A narrow local
patch lets a single final handshake ACK carry the first HTTP request instead
of silently discarding that payload. The libogc2 build also backports lwIP's
upstream RFC-correct `snd_nxt` fix so a retransmission cannot move the
GameCube's outgoing TCP sequence backward. Together these remove the
connection-level retransmission delays without host privileges. Libogc2's
upstream two-segment TCP receive window is preserved because it matches the
BBA's approximately two-frame receive ring; advertising four segments
overflowed the adapter and caused retransmission bursts. The upstream driver
also waits for two packets before raising a receive interrupt, leaving no
room for a second full-size frame while the first is pending. The local
one-packet interrupt patch drains the ring with one frame of headroom; in the
direct-Plex test it removed the 30-second catalog retry and delivered 93,863
bytes in about 0.54 seconds. Set
`GAMECUBE_PASTA_CAPTURE=1` to write `/tmp/multiplex-pasta.pcap` without
enabling timing-heavy trace logs.

`spike:gamecube:reference:plex` discovers a LAN Plex server (or uses
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
smoke test.

`scripts/plex-pair.py` implements Plex's current device-key PIN flow without
placing an account password or long-lived legacy token on the console. `start`
creates an Ed25519 device identity and strong PIN, `poll` exchanges a claimed
PIN for Plex's seven-day JWT, and `ensure` renews a token within one day of
expiry using Plex's nonce exchange. Its state file is mode `0600` and belongs
under the ignored `.plex-cache` directory. The gateway receives the ensured
server-specific access token through its process environment, never through
command-line arguments; the account JWT is used only with Plex's resource
directory and future account-backed features.

The spike retains three separate artifacts:

- `multiplex-gamecube-native-reference.dol`: exact Native SDK reference pixels
  presented through direct GX; this is the recommended visual baseline.
- `multiplex-gamecube-spike.dol`: the earlier command-to-GX approximation.
- `multiplex-gamecube-raylib-reference.dol`: the portability experiment. Its
  framebuffer and texture uploads work, but raylib4Consoles/OpenGX currently
  fails to draw the textured quads correctly on the tested GameCube stack.

The controller profile attaches a standard controller to SI port 1 and is
backed by `.dolphin-user/Pipes/multiplex1`. Dolphin pipe commands such as
`PRESS A`, `RELEASE A`, and `PRESS D_RIGHT` drive the automated player smoke
test. In the app, Z opens Search, Y opens Libraries, X advances the home hub,
and L/R either delete/submit the on-screen search query or page a library
backward/forward without walking focus through every poster.

## Source map

- `src/core.ts`: application model and update function
- `src/app.native`: declarative pairing, home, search, library browser,
  details, and player views
- `src/gamecube_probe.zig`: compiled view, layout, focus/handler resolution,
  GPU-packet translation, and C ABI
- `host-reference-gx/main.c`: reference framebuffer and direct-GX presenter
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
- `patches/libogc2-lwip-rfc-snd-nxt.patch`: upstream lwIP sequence-number
  semantics backported to libogc2's historical TCP stack
- `patches/libogc2-drain-bba-ring-per-packet.patch`: raise the BBA receive
  interrupt after one packet so its two-frame ring retains headroom
- `patches/passt-handle-data-on-handshake-ack.patch`: preserve application
  data piggybacked on the final TCP handshake ACK

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
periodic progress acknowledgements; PMS metadata advanced to the reported
resume offset while H.264/AAC playback stayed at 29.7–30.4 decode fps and 60.4
presentation fps with a clean invalid-access log. Leaving the player also
commits the current offset and integer progress percentage into the
TypeScript-owned home, search, or library item. Reopening that same item in the
verified run resumed at 7,547 ms without reloading the catalog.
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

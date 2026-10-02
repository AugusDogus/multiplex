# PlayStation 2 full-port design

## Outcome

The PlayStation 2 app is a thin console client. The canonical shared console
UI runs in a durable host gateway, which converts Native SDK draw output into
a bounded, pointer-free scene protocol. The PS2 samples controller input,
decodes scenes, renders them through gsKit, loads posters, and performs local
MPEG-2/MP2 playback.

This avoids the unsafe double-precision instructions emitted by the current
Zig R5900 target without creating a second implementation of the console UI.

## Boundaries

The host owns device pairing, Plex credentials, Plex server requests, the
canonical UI model, scene serialization, and media transcoding. The PS2 owns
DEV9 networking, semantic pad input, scene validation, GS presentation,
poster textures, MPEG program-stream demux, IPU video decode, MP2 decode,
SPU2 output, the playback clock, and timeline telemetry.

The wire protocol must not contain pointers, native `size_t`, C `bool`, or
unchecked offsets. Full scenes are versioned and bounded to 256 KiB. Inputs
carry monotonic sequence numbers and retries are idempotent.

## Delivery gates

1. BIOS-safe isolated PCSX2 boot.
2. Dynamic render and controller input.
3. DEV9 DHCP and nonce-bearing host HTTP round trip.
4. Typed scene replay from the canonical UI.
5. Stateful input round trip and real Plex catalog.
6. Two-minute MPEG-2/MP2 fixture playback.
7. Real Plex playback, pause, resume, seek, timeline, and stop.

Every ELF is checked for R5900 identity and unsafe opcodes. Every emulator
entry point exits before spawning PCSX2 when the explicit external BIOS is
missing or invalid. The BIOS and Plex credentials never enter repository or
test artifacts.

## Media constraints

The initial media contract remains the existing gateway MPEG program stream:
MPEG-2 Main Profile video, 4:2:0, at no more than the measured PS2 resolution
and bitrate, plus 48 kHz stereo MPEG Layer II audio. PS2SDK `libmpeg` and the
pinned `libmad` port are proof-gated before real Plex integration. Audio
consumption is the playback clock. Seek destroys the prior generation,
closes HTTP, stops audio, clears queues and decoder state, then reopens at a
validated boundary.

## Verification rule

Build, emulator render, network, fixture media, real catalog, and real media
are separate claims. A lower-layer success never implies a higher-layer one.

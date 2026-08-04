# GameCube hardware progress

Updated: 2026-08-04 12:49 CDT

## Goal

Run Multiplex on a physical GameCube with a DOL-015 Broadband Adapter, including
responsive Plex browsing and real-time video playback. Dolphin is the local
development harness. Physical hardware remains the acceptance target.

## Current state

Local playback is healthy again in Dolphin's true TAP path:

- Direct Plex catalog and all 19 poster requests complete.
- Plex selects H.264 at 362x270 and 29.970 fps with AAC stereo at 48 kHz.
- The decoder sustains 29.4 to 30.7 fps while the UI sustains 60.4 fps.
- A continuous run downloaded 26 consecutive eight-second HLS segments on the
  first attempt.
- A cold seek started a new transcode at sequence 130, became playable in about
  1.3 seconds, and downloaded another nine segments on the first attempt.
- Combined validation: 35 completed segments, zero retries, zero audio
  underruns, and zero Dolphin invalid reads or writes.

The remaining blocker is physical GameCube validation of this exact build.

## Cold-boot UI failure

The first physical launch of the minimal-network build reached the crash
handler instead of returning directly to Swiss:

- Diagnostic: `MGC-21`, native UI rendering failed
- Stage: waiting for DHCP
- DHCP status: `-1`, attempt 1, IP `0.0.0.0`
- Heap after cleanup: 515 KiB free, 5,601 KiB used

Startup had enabled the 512 KiB asynchronous reference-renderer stack before
DHCP, saved-account restoration, and cached-catalog binding finished. That made
cold boot the highest-memory and highest-concurrency render path. Startup now
keeps rendering synchronous until initialization is complete. Async transitions
are enabled only immediately before the steady-state event loop.

The failure screen now records the exact reference-frame status, render stage,
and whether the failed render was asynchronous. A, START, or Z performs a soft
restart so another attempt does not require a hard power cycle.

Validation after the change:

- An isolated no-network Dolphin boot remained stable for 90 seconds after the
  TAP creation failure, with no UI-render failure.
- A fresh true-TAP boot with the real region-specific memory-card image restored
  auth, decoded the three-row and 19-item catalog cache, refreshed the direct
  Plex catalog, and settled at 60.4 fps.
- The run logged no UI-render failure, invalid read, invalid write, or diagnostic
  exit.

## Fixes now under test

### Minimal hardware libogc2 profile

The application and diagnostic now have explicit hardware build targets. They
use the pinned upstream libogc2 commit plus exactly one networking change:

```c
#define TCP_WND TCP_MSS
```

All older local BBA receive-driver changes are excluded. This clean isolation
matters because the receive-ring DMA wrapping patch was the change that made
Dolphin's built-in BBA backend stall at about 2 KiB/s.

With the minimal one-MSS profile on true TAP, the diagnostic downloaded the
complete 3,504,666-byte Plex asset at 322 to 341 KiB/s. This disproves the
earlier conclusion that the one-MSS setting itself caused the physical-style
stall. That earlier test combined it with unrelated BBA driver patches.

Build commands:

```sh
bun run spike:gamecube:reference:hardware-dol
bun run spike:gamecube:bba-diagnostics:hardware-dol
```

### Plex transcode segment readiness

The universal transcode request now sends `waitForSegments=1`.

Plex can publish a segment URL before the segment body has finished being
written. Before this option, the client reached a newly listed segment, received
headers and only a tiny body, waited for 15 seconds, then retried successfully.
The same signature recurred later at sequence 117. Packet capture confirmed the
client acknowledged every byte it actually received, so this was not BBA loss.

Existing Plex clients use the same option:

- DreamPlex sets `waitForSegments=1` for transcoded playback.
- MrMC sets the `waitForSegments` URL option on Plex input streams.
- PlexForBoxee uses the same control.

After adding the option, the app passed the exact old failure point at sequence
117 and continued through sequence 125 without a retry. The cold seek then
completed sequences 130 through 138 without a retry.

## Measurements and conclusions

### Physical DOL-015, previous mixed patch stack

- GameCube: `192.168.86.193`
- Plex: `192.168.86.245:32400`
- One-MSS single response: 9 KiB in 10,082 ms, timeout
- One-MSS concurrent response: 932 KiB in 42,399 ms, timeout
- Two-MSS single response: 8 KiB in 14,399 ms, timeout
- Two-MSS concurrent response: 0 KiB in 8,000 ms, timeout

These measurements remain real, but they tested old libogc2 builds containing
multiple BBA receive-driver changes. They do not isolate the receive window and
are superseded by the clean-stack result above.

### Dolphin built-in BBA

The built-in host-socket backend remains unsuitable as a throughput oracle:

- It is highly sensitive to socket reader strategy.
- It logs `Partial sends might not be handled properly`.
- It can throttle or corrupt large responses with the receive-ring patch.
- A clean pinned libogc2 reader reached 139 KiB/s, while the same backend and
  alternate reader stalled near 2 KiB/s.

This is emulator-backend behavior. It is not proof that the physical BBA is
slow. Retail LAN games, Phantasy Star Online, Swiss, and existing homebrew all
demonstrate that the adapter can sustain useful traffic.

### True TAP

True TAP is the current deterministic integration harness because it exercises
the emulated BBA packet path instead of translating GameCube sockets to host
sockets. With the minimal libogc2 profile it now validates both network
throughput and real-time application playback.

Nintendont inside Dolphin would test a Wii IOS/socket compatibility path, not a
physical DOL-015. It is not a substitute for this hardware test.

### Cached home and Ethernet recovery

Physical hardware confirmed that the minimal HLS build can load the live Plex
posters and play Cowboy Bebop smoothly on the second launch. An unplugged
Ethernet cable exposed a separate startup bug: the saved catalog rendered, but
catalog and poster workers still started after DHCP failed. That left the home
screen without posters and could eventually return to Swiss.

The cached home is now an explicit offline state. DHCP runs in the background
after saved authorization and catalog data render. Catalog, poster, and account
workers remain gated until the adapter has a lease. A failed attempt keeps the
saved library responsive, presents an Ethernet notice, and retries with bounded
backoff. A recovered lease refreshes credentials if needed, refreshes the live
catalog, then starts poster loading.

An isolated true-TAP boot validated the new order: cached catalog ready in
419 ms, Ethernet ready in the background, live Plex catalog refreshed, and
playback remained free of invalid accesses, renderer failures, and decoder
failures.

## Next hardware test

1. Cold boot the GameCube and launch the new `Multiplex.dol` from Swiss.
2. Confirm whether `MGC-21` is gone. If it recurs, photograph the new `UI render`
   status, stage, and async fields.
3. Open the same Cowboy Bebop episode and enable Stats for Nerds.
4. Report UI fps, video fps, network KiB/s, queue levels, audio underruns, heap,
   and any diagnostic code.
5. If playback stalls, run `Multiplex-BBA-Throughput.dol` once and report both
   the single-stream and concurrent results.

Do not add more transport patches until this exact minimal build has been tested
on the DOL-015. If it still fails, the next useful evidence is a USB Gecko trace
of the minimal stack rather than another broad networking change.

## Artifacts

- App source DOL: `multiplex-gamecube-native-reference.dol`
- Diagnostic source DOL: `multiplex-gamecube-bba-diagnostics.dol`
- SD app: `/run/media/augie/WII/games/Multiplex.dol`
- SD diagnostic: `/run/media/augie/WII/games/Multiplex-BBA-Throughput.dol`

- App SHA-256:
  `a692a53785e223d15c43ef85630d9b8dcbf73a83e455152efe5d9e19b4b665ab`
- Diagnostic SHA-256:
  `199e23d2f85f6f4732cd391f67e4d840a2ab7485a70bbe007b3fcca697023456`

# GameCube hardware progress

Updated: 2026-08-04 00:07 CDT

## Goal

Run Multiplex on a physical GameCube with a DOL-015 Broadband Adapter, including
responsive Plex browsing and real-time video playback. Dolphin is a development
tool, not the hardware acceptance target.

## Current blocker

Large plain-HTTP responses from Plex stall through libogc2 on the physical BBA.
The same diagnostic and library complete at media-class speed through Dolphin's
rootless TAP backend.

This benchmark does not use TLS. HTTPS overhead is therefore ruled out as the
cause of the measured transport failure.

## Measurements

### Physical DOL-015, patched one-MSS receive window

- GameCube: `192.168.86.193`
- Plex: `192.168.86.245:32400`
- Single response: 9 KiB in 10,082 ms, timeout
- Concurrent response: 932 KiB in 42,399 ms, timeout
- Concurrent `/identity` request: HTTP 200 in 1 ms

### Physical DOL-015, upstream two-MSS receive window

- Single response: 8 KiB in 14,399 ms, timeout
- Concurrent response: 0 KiB in 8,000 ms, timeout
- Concurrent `/identity` request: about 1,006 ms

This experiment regressed throughput and was reverted in commit `2f572005`.

### Dolphin 2606 rootless TAP, restored one-MSS baseline

- Exact diagnostic target: Plex Web JavaScript asset, 3,504,666 body bytes
- Single response: 527 KiB/s in 6,488 ms, no timeout
- Concurrent response: 551 KiB/s in 6,208 ms, no timeout
- Concurrent `/identity` request: HTTP 200 in 18 ms
- Packet capture: `/tmp/multiplex-pasta.pcap`
- No TCP retransmission, loss, or duplicate-ACK analysis flags were reported by
  tshark during either large response

### Stock Dolphin 2606 built-in BBA, restored one-MSS baseline

- Both the existing `select` reader and a Swiss-style nonblocking reader stalled
- Existing reader: 1 KiB/s, 42,480 bytes in 20,906 ms
- Swiss-style reader: 2 KiB/s, 48,640 bytes in 21,058 ms
- Both readers had roughly 1,110 ms gaps between received chunks
- Concurrent control request still returned HTTP 200
- Dolphin logged `Partial sends might not be handled properly`

This backend reproduces a large-response stall, but its regular one-second gaps
are emulator behavior and not evidence about the physical adapter.

### Stock Dolphin 2606 built-in BBA, clean pinned libogc2

- Existing reader: 139 KiB/s, 2,972,880 bytes in 20,835 ms
- Swiss-style reader: 2 KiB/s, 49,960 bytes in 20,263 ms
- Concurrent Swiss-style reader: 4 KiB/s, 96,800 bytes
- Concurrent control request returned HTTP 200

The built-in backend is reader-sensitive and remains unsuitable as a hardware
throughput oracle. It is still useful as a deterministic patch-regression test.

### Stock Dolphin 2606 built-in BBA, only three local BBA receive-driver patches

The tested patches were receive-ring DMA wrapping, malformed-descriptor
recovery, and dropping a frame when pbuf allocation fails.

- Existing reader: 2 KiB/s, 49,280 bytes in 20,283 ms
- Swiss-style reader: 1 KiB/s, 41,160 bytes in 20,488 ms
- Concurrent Swiss-style reader: 2 KiB/s, 42,480 bytes in 20,388 ms
- Concurrent control request: HTTP 200 in 3,005 ms
- Maximum gaps remained about one second

This isolates the built-in Dolphin regression to the three BBA receive-driver
patches. The next local bisection tests the DMA wrapping patch by itself.

### Stock Dolphin 2606 built-in BBA, receive-ring DMA wrapping patch only

- Existing reader: 2 KiB/s, 49,960 bytes in 20,288 ms
- Swiss-style reader: 2 KiB/s, 50,400 bytes in 20,293 ms
- Concurrent Swiss-style reader: 2 KiB/s, 48,840 bytes in 20,302 ms
- Concurrent control request: HTTP 200 in 2,995 ms

The DMA wrapping patch alone reproduces the regression. The next split keeps
the boundary-aware DMA copy but replaces per-receive BBA boundary-register
reads with the fixed values programmed during BBA initialization.

Replacing the boundary-register reads with initialization constants produced
the same 2 KiB/s result. The split DMA transaction itself triggers Dolphin's
built-in backend failure. Dolphin copies DMA reads linearly and does not wrap
at the configured BBA ring boundary, so the patch is valid for Dolphin's LLE
memory model even though its built-in host-socket translation reacts badly to
the resulting correct packet stream.

Current upstream libogc2 remains unchanged in this driver area relative to the
pinned commit. Swiss therefore remains evidence for the unmodified receive
driver, not for any of the local driver patches.

## Clean-stack application build

The application now supports linking against unmodified upstream libogc2. Its
TLS adapter treats the local `net_flush` extension as optional; sockets already
enable `TCP_NODELAY`, whose upstream libogc2 write path calls `tcp_output`.

- Clean-stack DOL: `/tmp/multiplex-gamecube-clean-libogc2.dol`
- SHA-256: `007976712a1363d94945b81b0876531ea5a4a8262eec95f01d036baf9ed0edc3`
- Size: 4,011,800 bytes

This is a candidate for the physical BBA after the clean diagnostic. It has not
replaced the SD-card application yet.

### Clean-stack application on stock Dolphin built-in BBA

- Saved auth, cached catalog, direct Plex catalog, 19 posters, TLS, and details
  prefetch all completed
- The interactive home became ready and remained at 59.9 to 60.4 fps
- HLS selected H.264 at 362x270, 29.970 fps and AAC stereo at 48 kHz
- The first segment then trickled for about 54 seconds, reached only 135,168
  bytes, contained a bad MPEG-TS sync byte, and stopped with `MGC-30`
- Dolphin printed `Partial sends might not be handled properly` throughout

This is direct evidence that stock Dolphin's built-in host-socket backend both
throttles and corrupts this large response. It is not an application decoder
failure or evidence of physical BBA bandwidth.

### Clean libogc2 with corrected Dolphin receive-ring DMA on TAP

- Existing reader: 3 KiB/s, 72,800 bytes, timeout
- First Swiss-style run failed before receiving a body
- Concurrent Swiss-style reader: 343 KiB/s, all 3,504,666 bytes in 9,976 ms
- Concurrent control request: HTTP 200 in 2,944 ms

The same stream becomes healthy when a tiny second request runs. This closely
matches the physical signature where the concurrent case was dramatically
faster than the lone stream. In upstream libogc2, `tcp_recved` opens the receive
window from the network thread but does not immediately call `tcp_output`.
Calling `tcp_output` after `tcp_recved` did not improve the result because the
first receive-window update remains marked as a delayed ACK. Forcing an
immediate ACK was also unstable and did not produce a healthy lone stream, so
neither experiment is shipped.

### Dolphin rootless TAP, completely clean pinned libogc2

- Plex index stopped after 7,300 bytes
- Packet capture showed duplicate ACKs, retransmissions, then a zero window
- The same TAP path works at about 0.5 MiB/s with the patched one-MSS libogc2

This confirms the TAP harness and local patches are coupled. It does not show
that the clean stack is bad on real hardware.

## Conclusions supported by evidence

- The BBA hardware is not assumed to be slow. Proven retail games and Swiss use
  it for sustained networking.
- Periodic Plex timeline traffic is not the primary transport failure. A single
  large response fails before concurrent control traffic is introduced.
- TLS is not involved in the standalone throughput failure.
- The current DOL and diagnostic run in Dolphin. Dolphin does not reproduce the
  physical receive failure when using the patched TAP path.
- Stock Dolphin's built-in BBA is not a throughput oracle for this homebrew. It
  stalls both socket-reader strategies and logs an incomplete-send warning.
- Nintendont's BBA emulation is a Wii IOS/socket compatibility path for selected
  retail games. Running Nintendont inside Dolphin cannot validate a DOL-015, and
  Dolphin does not emulate the Wii Starlet closely enough for it to be a useful
  replacement for this test.
- Swiss builds against clean libogc2 and supports SMB, FTP, and FSP transfers on
  a DOL-015. A clean-stack hardware A/B is therefore the closest available prior
  art comparison.
- The one-MSS Dolphin-era libogc2 patch helps this physical setup relative to the
  upstream two-MSS behavior, but it does not make hardware throughput viable.
- Do not change TCP-window behavior again without a counter or packet trace that
  identifies the failure mode.

## Open hypotheses

1. One of the local libogc2 patches needed by the Dolphin TAP harness regresses
   the physical DOL-015 path.
2. The physical BBA receive ring overflows or reports descriptor errors that the
   emulator does not reproduce.
3. A local libogc2 receive-DMA or malformed-descriptor patch behaves differently
   on a real DOL-015.
4. The old lwIP socket layer stops reopening its advertised window correctly
   after a specific receive pattern, independently of TLS.
5. The standalone reader is using `select` or `recv` incorrectly for libogc2 and
   Dolphin happens not to expose it.
6. Link negotiation or the LAN path causes loss bursts on hardware. Small HTTP
   responses succeeding does not rule this out.

## Next evidence required

- Run the clean-libogc2 diagnostic on the physical DOL-015. It includes both the
  existing `select` reader and Swiss's nonblocking 2 KiB polling pattern.
- Display BBA RX packets, bytes, ring-full interrupts, descriptor errors, pbuf
  allocation failures, TCP receives, drops, retransmits, and the final socket
  error on the physical result screen.
- Only after classifying the stall, change one layer and repeat the same plain
  HTTP benchmark.

## Hardware artifacts

- App: `/run/media/augie/WII/games/Multiplex.dol`
- Diagnostic: `/run/media/augie/WII/games/Multiplex-BBA-Throughput.dol`
- Source app DOL: `multiplex-gamecube-native-reference.dol`
- Source diagnostic DOL: `multiplex-gamecube-bba-diagnostics.dol`

The current SD diagnostic is the clean-libogc2 A/B build. Its SHA-256 is
`27441a06a474f1e30f54305251c58798edf432540d01b92e0f46d8c36d8574af`.
The obsolete second diagnostic filename was removed from the SD card so there is
one app DOL and one diagnostic DOL.

The SD application is now the clean-libogc2 hardware build. Its SHA-256 is
`23f04c6e3d1ec7eee31ec3665eb4c2e1127ebdc0113ba0ddfbefe265d4500fbc`.
The previous patched application is recoverable from
`/tmp/multiplex-gamecube-patched-sd-backup.dol` with SHA-256
`0f44b0d9ef33cf8c933140c22ca04b1440348117bbd5fa2dc1f9263e18dafc09`.

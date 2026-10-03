# Original Xbox runtime architecture

The Xbox app is a thin nxdk host around the same console UI and service state
machines used by GameCube and Wii. Platform code owns SDL presentation,
controller input, FATX persistence, networking, threads, audio, and decoded
video upload. It must not duplicate Plex, playback, or Watch Together policy.

The migration keeps `packages/libogc-gx` green at every step:

1. Move transport-free records, parsers, request slots, scheduling, and policy
   into one portable `console-core` boundary.
2. Keep credentials, server URLs, tRPC wire values, and Syncplay endpoints
   private to service adapters. Runtime state receives semantic snapshots.
3. Let one media supervisor own the active HLS session, replacement seeks,
   audio-sample timeline, and decoded-frame borrows.
4. Implement libogc and nxdk ports for storage, HTTP and TLS, threads, audio,
   and video. No portable header may expose libogc, nxdk, or SDL types.
5. Migrate the GameCube and Wii composition root, then delete compatibility
   forwarding headers once both hosts use the portable runtime directly.

The public app surface stays small: open, step, present, and close. Expected
failures use tagged states. Worker results carry request tokens so stale
catalog loads and replacement seeks cannot overwrite newer state.

The xemu smoke test is the first platform gate. It builds a real XISO, boots
the supplied legal firmware in xemu under headless gamescope, and recognizes
the Multiplex launch screen from the captured 640x480 framebuffer.

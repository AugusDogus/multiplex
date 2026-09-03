# Multiplex for Dreamcast

This app is a native KallistiOS client for the Dreamcast. It compiles a
portable C app model with GCC for SH-4, renders live UI state into an RGB565
texture, and presents it through the Dreamcast PVR at 640x480.

The current vertical slice is interactive: A connects to the demo gateway,
the D-pad moves through the home shelf, A opens details and emits a typed
playback request, and B navigates back. Start exits. The app model is isolated
from KallistiOS so the gateway and media services can consume its connect and
playback requests without owning UI state.

The Dreamcast does not compile the shared Native SDK Zig archive used by
GameCube and Wii. Released Zig still lacks an SH code-generation backend, and
the [upstream LLVM SuperH target](https://github.com/llvm/llvm-project/pull/181287)
is not production-ready. The Dreamcast client therefore uses C for its
portable application layer and keeps platform work behind service boundaries
instead of waiting on compiler support.

Build it from the repository root:

```sh
bun run dreamcast:bootstrap
bun run dreamcast:test
bun run dreamcast:build
```

Flycast verification is optional:

```sh
bun run dreamcast:flycast:bootstrap
bun run dreamcast:smoke
```

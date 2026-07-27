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
```

`spike:gamecube:reference:run` uses an isolated Dolphin profile and replaces
its previous recorded process, keeping one emulator instance open. The managed
profile exposes a component-capable output, so the presenter selects 640x480
progressive scan; composite-only hardware falls back to the preferred
interlaced mode.

The spike retains three separate artifacts:

- `multiplex-gamecube-native-reference.dol`: exact Native SDK reference pixels
  presented through direct GX; this is the recommended visual baseline.
- `multiplex-gamecube-spike.dol`: the earlier command-to-GX approximation.
- `multiplex-gamecube-raylib-reference.dol`: the portability experiment. Its
  framebuffer and texture uploads work, but raylib4Consoles/OpenGX currently
  fails to draw the textured quads correctly on the tested GameCube stack.

The controller profile attaches a standard controller to SI port 1 and is backed by
`.dolphin-user/Pipes/multiplex1`. Dolphin pipe commands such as `PRESS A`,
`RELEASE A`, and `PRESS D_RIGHT` can drive automated smoke tests.

## Source map

- `src/core.ts`: application model and update function
- `src/app.native`: declarative pairing, library, and details views
- `src/gamecube_probe.zig`: compiled view, layout, focus/handler resolution,
  GPU-packet translation, and C ABI
- `host-reference-gx/main.c`: reference framebuffer and direct-GX presenter
- `host/main.c`: earlier command-to-GX approximation
- `host-raylib/main.c`: experimental raylib/OpenGX presenter
- `scripts/generate-font-atlas.py`: converts Native SDK's bundled Geist Regular
  to an antialiased, GX-tiled I8 atlas
- `patches/native-sdk-single-threaded-canvas.patch`: the two small portability
  changes applied to the pinned Native SDK checkout

## Current boundary

The direct-GX reference presenter preserves Native SDK's font rasterization,
antialiasing, rounded corners, strokes, shadows, and compositing. It divides
the 640x480 RGBA frame into sixteen 160x120 GX RGBA8 textures and presents them
through double-buffered XFBs. Its pixel-center projection covers every EFB row
without leaving uninitialized edge pixels.

The reference render now uses one pass rather than rendering the same pixels
three times. The pairing frame costs about 0.55 seconds in Dolphin and
RGBA-to-GX conversion costs about 10 ms. Focus-only home-screen changes use
Native SDK dirty bounds and cost about 0.19–0.23 seconds instead of the
7.08-second full home raster. A bounded reference-render memo retains three
expensive stable layers: warmed full home repaints cost about 0.64 seconds and
warmed details repaints about 0.52 seconds, with byte-identical signatures.
The memo has a 4 MiB hard limit and peaked at 4,093 KiB in the home/details
flow. The retained frame still presents at a measured 60.4 progressive frames
per second. This remains a fidelity baseline rather than a production
renderer; the next renderer gate is reducing the 7–8 second cold render the
first time a screen appears.

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

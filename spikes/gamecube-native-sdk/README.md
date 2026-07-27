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
`RELEASE A`, and `PRESS D_RIGHT` drive the automated player smoke test.

## Source map

- `src/core.ts`: application model and update function
- `src/app.native`: declarative pairing, library, details, and player views
- `src/gamecube_probe.zig`: compiled view, layout, focus/handler resolution,
  GPU-packet translation, and C ABI
- `host-reference-gx/main.c`: reference framebuffer and direct-GX presenter
- `scripts/smoke-dolphin-player.sh`: player navigation, animation,
  pause/resume, and invalid-access assertions
- `host/main.c`: earlier command-to-GX approximation
- `host-raylib/main.c`: experimental raylib/OpenGX presenter
- `scripts/generate-font-atlas.py`: converts Native SDK's bundled Geist Regular
  to an antialiased, GX-tiled I8 atlas
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
320x180 producer texture into that exact rectangle. The current producer is an
animated test stream, not a decoder, but it exercises the eventual decoder
boundary at 30.3 fps while presentation remains 60.4 fps. Play/Pause freezes
and resumes production without rerasterizing video into the UI framebuffer.

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
measured 60.4 progressive frames per second. This remains a fidelity baseline
rather than a production renderer; the next Dolphin gate is replacing the
test-card producer with decoded local media while retaining the same surface
ABI.

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

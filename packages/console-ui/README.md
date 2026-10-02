# Multiplex console UI

This package owns the single TypeScript model, `.native` view, icon set,
freestanding Native SDK adapter, C ABI, and guarded RGBA reference frame used
by native console clients.

It intentionally has no dependency on GX, libogc, devkitPPC, controller APIs,
networking, storage, or media playback. GameCube and Wii consume it through
the freestanding archive and C header. A future non-GX console can compile the
same authored UI for its own target with `-Dconsole-target` and
`-Dconsole-cpu`, then provide its own host and presenter.

PlayStation 2 consumes a build-time export of the guarded RGBA reference frame.
Zig 0.16 can emit the console's N32 ABI, but its MIPS backend emits
double-precision instructions that the R5900 cannot execute. The PS2 tracer
therefore keeps the shared authored UI while its gsKit host remains static.

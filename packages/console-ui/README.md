# Multiplex console UI

This package owns the single TypeScript model, `.native` view, icon set,
freestanding Native SDK adapter, C ABI, and guarded RGBA reference frame used
by native console clients.

It intentionally has no dependency on GX, libogc, devkitPPC, controller APIs,
networking, storage, or media playback. GameCube and Wii consume it through
the freestanding archive and C header. A future non-GX target with Zig code
generation can compile the same authored UI with `-Dconsole-target` and
`-Dconsole-cpu`, then provide its own host and presenter.

Dreamcast uses a portable C app model because released Zig cannot emit SH-4
code. It follows the same explicit model, input, service-event, and platform
host boundaries without making the in-progress LLVM SuperH backend a product
dependency.

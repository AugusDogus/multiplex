# Multiplex console UI

This package owns the single TypeScript model, `.native` view, icon set,
freestanding Native SDK adapter, C ABI, and guarded RGBA reference frame used
by native console clients.

It intentionally has no dependency on GX, libogc, devkitPPC, controller APIs,
networking, storage, or media playback. GameCube and Wii consume it through
the freestanding archive and C header. A future non-GX console can compile the
same authored UI for its own target with `-Dconsole-target` and
`-Dconsole-cpu`, then provide its own host and presenter.

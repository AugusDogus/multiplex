# Multiplex libogc/GX runtime

This package owns the runtime shared by the GameCube and Wii apps: libogc
lifecycle and services, GX presentation, media playback, networking, storage,
and the bridge to `@multiplex/console-ui`.

It is intentionally specific to the libogc/GX family. Future consoles without
GX reuse `@multiplex/console-ui` and provide a different host.

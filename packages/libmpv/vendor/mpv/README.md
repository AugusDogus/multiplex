# libmpv SDK boundary

The native addon links against a pinned libmpv SDK staged here by the desktop
artifact builder:

```text
vendor/mpv/include/mpv/client.h
vendor/mpv/include/mpv/render.h
vendor/mpv/include/mpv/render_gl.h
vendor/mpv/lib/...
```

The SDK and runtime libraries are deliberately not checked into git. Release
artifacts must pin and verify a platform build, stage its licenses, build this
Node-API addon, and copy the runtime libraries beside the addon.

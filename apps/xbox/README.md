# Multiplex for Original Xbox

This app is the Original Xbox composition root. It compiles the shared
`@multiplex/console-ui` application for the Xbox Pentium III, presents its
640x480 RGBA frame through nxdk's SDL2 backend, and maps an Xbox controller to
the shared console actions.

The current platform slice boots the shared console UI in xemu, accepts an Xbox
controller, pairs through the Multiplex gateway, and stores credentials on the
FATX data partition. Catalog and media adapters are still being moved behind
the shared portable runtime described in `ARCHITECTURE.md`.

Build it from the repository root:

```sh
bun run xbox:bootstrap
bun run xbox:reference:xbe
```

The build writes `apps/xbox/multiplex-xbox-native-reference.xbe`.

Set `MULTIPLEX_XBOX_BASE_URL` while building to enable pairing. The current
nxdk transport supports HTTP gateway URLs only, so use a trusted local network
or a local TLS terminator:

```sh
MULTIPLEX_XBOX_BASE_URL=http://192.168.1.20:3000 \
  bun run xbox:reference:xbe
```

To run the real XISO in headless xemu, import legal dumps from your console and
run the smoke gate:

```sh
bun run xbox:emulator:files -- ~/Downloads/Xbox-Emulator-Files.zip
bun run xbox:emulator:smoke
```

The firmware, working HDD, emulator binary, XISO, logs, and screenshot remain
ignored under `apps/xbox`.

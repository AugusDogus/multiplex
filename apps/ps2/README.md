# Multiplex for PlayStation 2

This app is the PlayStation 2 composition root. It exports the shared
`@multiplex/console-ui` reference frame, embeds it in a PS2SDK ELF, and
presents it through gsKit at the console's active display resolution.

The current target is a presentation tracer. Networking, live UI input, and
media playback are not wired yet. Zig 0.16 can emit the R5900 toolchain's N32
ABI, but it emits double-precision MIPS instructions that the R5900 cannot
execute. The build exports the shared UI on the host until that compiler gap
has a safe lowering.

Build it from the repository root:

```sh
bun run ps2:bootstrap
bun run ps2:reference:elf
```

The build writes `apps/ps2/multiplex-ps2-native-reference.elf`. Run that ELF
with a PS2 homebrew loader or a PlayStation 2 emulator.

# Meson console cross files

The root `meson.build` is the canonical native build graph. Its first target is
the portable auth-record library and host test. The existing devkitPro Makefiles
remain the DOL target adapter until their object lists, linker scripts, generated
assets, and final DOL conversion have been migrated and compared safely.

Put a local Meson cross file in this directory as `gamecube.ini`. It is
intentionally untracked because devkitPro paths vary by workstation. Start
from the committed example, then configure without Meson network access:

```sh
uv run --project apps/gamecube --locked meson setup \
  build/native-gamecube \
  --cross-file apps/gamecube/cross/gamecube.ini \
  --wrap-mode=nodownload
```

Future native clients should add a root-level `subdir()` and link the reusable
`multiplex_auth_record_dependency` declared by `packages/libogc-gx/meson.build`.
Keep explicit source lists in each client subdirectory. Do not add Meson wrap
downloads or configure-time dependency fetches.

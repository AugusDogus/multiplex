# Upgrade Mbed TLS

## Current reviewed pin

The GameCube app uses Mbed TLS 3.6.7, released 2026-07-07. The annotated tag
`mbedtls-3.6.7` resolves to commit
`068ff080b369adfac81509f9b57b2afabaf82dc5`.

The review covered the official release notes for [Mbed TLS
3.6.5](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.5),
[3.6.6](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.6), and
[3.6.7](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7).

| Release | Impact on the GameCube build                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.6.5   | Fixes the CBC PKCS#7 padding timing leak retained by the default client profile. The RSA private-key side channel does not expose a GameCube key because the app stores no long-term RSA or ECC private key. No used public API changed.                                                                                                                                                       |
| 3.6.6   | Fixes TLS 1.2 signature-algorithm validation, CCM bounds, FFDH peer validation, IPv6 X.509 name parsing, and pre-handshake verification-result reporting in retained code. Linux entropy-device and process-cloning changes do not apply to the console. TLS 1.3 server fixes are disabled.                                                                                                    |
| 3.6.7   | Fixes TLS 1.2 extended-master-secret error propagation, ChaCha20 counter wrap, ECDH output bounds, malformed ECC public keys, and invalid X.509 basic constraints. It also restores valid TLS 1.2 RSA-PSS `ServerKeyExchange` handling. TLS 1.3, DTLS, server, PKCS7, EC J-PAKE, and PSK-only fixes do not reach an application call path. The app stores no long-term RSA or ECC private key. |

The inherited profile still compiles PKCS7 and PSK key-exchange code, but the
GameCube app calls neither the PKCS7 API nor a PSK configuration API. It retains
the TLS 1.2 client, X.509, ECDH, ECC, ChaCha20, CBC, RSA, and DHM code available
to Plex and Multiplex connections.

Filtering the pinned devkitPPC preprocessor output to `MBEDTLS_*` macros found
no feature-selection changes. The values of four existing version macros
changed. The 3.6.7 headers also expose three additional internal entropy
bookkeeping macros. `MBEDTLS_PLATFORM_ENTROPY_ENABLED` remains zero.
`MBEDTLS_NO_PLATFORM_ENTROPY` keeps the application-local one-shot seed and
CTR-DRBG as the random source.

The public `mbedtls_x509_dn_get_next()` signature and relative-name boundary
semantics did not change. `packages/libogc-gx/src/x509_name_compare.c` still reads
only public `oid`, `val`, and `next` fields. Do not access `MBEDTLS_PRIVATE`,
`next_merged`, or another private Mbed TLS representation. The CA callback must
continue to parse one PEM certificate at a time instead of retaining the full
Mozilla bundle.

## Recorded size evidence

The measurements use the same config, compiler flags, and pinned devkitPPC
image for both releases:

| Release | Archive file bytes | Object `text + data + bss` bytes |
| ------- | -----------------: | -------------------------------: |
| 3.6.4   |          5,259,420 |                          700,908 |
| 3.6.7   |          5,271,516 |                          702,906 |
| Delta   |            +12,096 |                           +1,998 |

Run `sh apps/gamecube/scripts/measure-mbedtls.sh` to regenerate the values for
the staged archives. The script rejects a stale stage before measuring it.
Archive file bytes include debug sections and objects that the linker may
discard, so compare DOLs built from the same application source as a separate
linker-level measurement.

The controlled link rebuilt every application C object for each stage. It
reused the same generated CA and endpoint headers and the same core archive.
The core archive had no undefined Mbed TLS or PSA symbols. Each stage was built
twice in isolated directories. Each repeat matched its corresponding first DOL
byte for byte.

| Release | DOL bytes |  ELF text |  ELF data |   ELF BSS |  ELF total |
| ------- | --------: | --------: | --------: | --------: | ---------: |
| 3.6.4   | 4,095,256 | 2,182,463 | 1,912,472 | 6,983,084 | 11,078,019 |
| 3.6.7   | 4,095,448 | 2,181,847 | 1,913,296 | 6,983,084 | 11,078,227 |
| Delta   |      +192 |      -616 |      +824 |         0 |       +208 |

The controlled run used devkitPPC image
`docker.io/devkitpro/devkitppc@sha256:4c919aa26151dd43d88ca28c922d1fe2409579a8ba60ef56517baf1abdfb1a48`
and recorded these SHA-256 values:

| Input                       | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Core archive                | `613202d8e064a66814a00b900a5a3e3d3ab50615592837ab84e627a93903d296` |
| libogc                      | `b7fea957a75dbcaf212996133deaf2198d82d26599da8a4dd814d589dde2e1be` |
| libbba                      | `ddb4007b5225a943056bc0e0254f08fa55bf51707d2eb5ddf64cdfbf7ef8633e` |
| libavcodec                  | `3ed2645cffa9f1b0400b73372f327153dded4fe8355a6c65f91fae04bc87887a` |
| libavutil                   | `aea33c1814e8ef1689bbadd154c188ac90be1adfcaccd581c7070fe4bde74071` |
| libogc rules and headers    | `ffabc4002a2781b529f32fd09f2df84ea23e4c86adf0fe4e395697e243124ef5` |
| FFmpeg headers              | `2e0bc5828d97f52e486e2e84fe2c1fb2c87583d52fb43e597574dc5cfc8bcda3` |
| 3.6.4 libmbedtls            | `de5c70ab44cba433e2c8d2b09f42d10b8c62475ffd3614c8a651f395504fe7f4` |
| 3.6.4 libmbedx509           | `30f0aca13c967526a9d0f6c7f25718d87fe4341f5082fc290143d29d0494c1f6` |
| 3.6.4 libmbedcrypto         | `310669b53de83a31833d1edfa16d861b61a72e08b698d00852c24c97e6f1cc81` |
| 3.6.4 public headers        | `427ba6bbfe05b33af75c0ef3c67244abdde66d2823504eec1dde91454422cd20` |
| 3.6.7 libmbedtls            | `eb23d43b7781b2adba4548d6cec1fc28c41e6a8e1036f95c4923b7a8270a0c5a` |
| 3.6.7 libmbedx509           | `bbc6fa3596800782cb0e9dbc2cd64580fe342f271d941a29144120f2979d54ce` |
| 3.6.7 libmbedcrypto         | `3898b14a63cd426ab3ca4f820d3bf7b2a701248dea354b8ba3ae40bd37d6d7f3` |
| 3.6.7 public headers        | `db1feef00f8c574acf24b4d140d88b74b531d99d2053a0a4a17351131905cc74` |
| Application source manifest | `ecc230931f7531b886599719d8ce287de52a50d35750713b8044b8ac6f55486d` |
| Font atlas header           | `5de6a9df69bdf7525d9db552b4418b7074be6bb5faa851e2439cd1f85aff4e35` |
| DVD fixture                 | `39d3ba3e498faa7eca4d751898736abf78fc752dbdef35bfcae9cd775824f874` |
| Endpoint inputs             | `50a34eebbb268fe8ddf23d400cd6c2e44c9f83de0711e5ae13535028fc2ba8bf` |
| Generated endpoint header   | `6914a5beabe2cf6e51b66425f411eff24dace816c241a88a5db6039c0cb0df36` |
| Mozilla CA input            | `3ff344e30b9b1ed2971044eabb438a08f2e2245ddb5f8ab1a3ad8b63ab4eaf91` |
| Generated CA header         | `c1aa7a74c72160c7b86c11414f6d8026d49650a622911ff93128dea3a156b1b5` |

The run had no supplemental CA input. The application manifest covers the
GameCube makefile and every C and header input under `host`, `host-reference`,
and `packages/libogc-gx/src`. The external header manifests hash each file together
with its sorted path relative to the mounted tree, so either a content change
or a rename changes the manifest hash. The libogc manifest also includes
`gamecube_rules`.

Run the committed comparison lever with two read-only stages. It creates and
removes only its isolated build directories:

```sh
sh apps/gamecube/scripts/compare-mbedtls-dol.sh \
  /path/to/mbedtls-3.6.4-stage apps/gamecube/.mbedtls-stage
```

Mbed TLS 3.6.6 moved about 2 KiB PK buffers from the stack to the heap for
configurations that are not ECC-only. This build retains RSA and DHM, so capture
the actual heap effect on hardware. Record the `Stats for nerds` free-heap value
before the first TLS connection, after the catalog and artwork load, and during
playback. No hardware heap measurement is recorded for this upgrade.

## Review a future release

1. Read each official release page and linked security advisory since the
   current pin.
2. Confirm that the release belongs to the supported 3.6 LTS branch.
3. Resolve the annotated tag to its commit:

   ```sh
   : "${candidate_tag:?Set candidate_tag to the reviewed annotated release tag}"
   git -C apps/gamecube/.mbedtls fetch origin tag "$candidate_tag"
   test "$(git -C apps/gamecube/.mbedtls cat-file -t "$candidate_tag")" = tag
   candidate_commit=$(git -C apps/gamecube/.mbedtls rev-parse "$candidate_tag^{}")
   printf '%s\n' "$candidate_commit"
   ```

4. Compare `ChangeLog`, `include/mbedtls`, `include/psa`, and `library` between
   the old and new commits. Review TLS 1.2 client, X.509, entropy, CTR-DRBG, and
   configuration changes first.
5. Compare the preprocessed feature macros before changing the pin. Explain
   every difference.

## Update and verify the pin

Before changing the pin, preserve the current stage for the two-pin comparison:

```sh
baseline_stage=$(mktemp -d)
cp -a apps/gamecube/.mbedtls-stage/. "$baseline_stage/"
```

Replace `MBEDTLS_COMMIT` in `PINS.env` with the reviewed `candidate_commit`,
then align the ignored checkout and rebuild the staged public headers and
reduced PowerPC archives:

```sh
: "${candidate_commit:?Set candidate_commit to the reviewed tag commit}"
git -C apps/gamecube/.mbedtls checkout --detach "$candidate_commit"
git -C apps/gamecube/.mbedtls submodule update --init --depth 1
bun run gamecube:bootstrap
sh apps/gamecube/scripts/measure-mbedtls.sh
sh apps/gamecube/scripts/test-measure-mbedtls.sh
```

Run the source, host, sanitizer, analysis, and PowerPC gates:

`test-mbedtls-verification.sh` uses the pinned upstream certificate fixtures
and the production TLS client verification boundary. It freezes certificate
time, requires a valid TLS 1.2 trust and hostname handshake to succeed, then
requires an untrusted root and hostname mismatch to fail with their exact X.509
flags. The script checks its host CMake, C compiler, and Python prerequisites.
Use `GAMECUBE_MBEDTLS_SOURCE_DIR` and `GAMECUBE_MBEDTLS_STAGE_DIR` to test
non-default read-only source and stage paths.

```sh
CC="$PWD/apps/gamecube/scripts/sanitize-cc.sh" \
  sh apps/gamecube/scripts/test-mbedtls-verification.sh
bun run gamecube:lint
bun run gamecube:analyze
bun run gamecube:test:portable
bun run gamecube:test:sanitize
bun run gamecube:reference:dol
: "${baseline_stage:?Set baseline_stage to the preserved stage path}"
sh apps/gamecube/scripts/compare-mbedtls-dol.sh \
  "$baseline_stage" apps/gamecube/.mbedtls-stage
```

Inspect the staged `mbedtls/build_info.h` macros and the three archive symbol
tables. Require TLS 1.2 client support, certificate parsing, hostname
verification, the trusted-certificate callback, CTR-DRBG, the HTTP client, and
Syncplay primitives. The DOL link checks catalog, artwork, HLS, tRPC, and
Syncplay consumers against the staged public headers and libraries.

Run the macro command once for each staged release and diff its output:

```sh
. apps/gamecube/PINS.env
: "${baseline_stage:?Set baseline_stage to the preserved stage path}"
: "${candidate_stage:=apps/gamecube/.mbedtls-stage}"
macro_output_dir=$(mktemp -d)
preprocess_mbedtls_macros() {
  stage_path=$(CDPATH= cd -- "$1" && pwd)
  output=$2
  podman run --rm \
    --volume "$PWD/apps/gamecube:/workspace:ro,Z" \
    --volume "$stage_path:/stage:ro,Z" \
    "$DEVKITPPC_IMAGE" sh -ec '
      export PATH=/opt/devkitpro/devkitPPC/bin:$PATH
      powerpc-eabi-gcc -dM -E \
        -I/stage/include \
        -I/runtime/src \
        -DMBEDTLS_CONFIG_FILE=\"mbedtls-gamecube-config.h\" \
        -include mbedtls/build_info.h - </dev/null |
        grep "^#define MBEDTLS_" |
        sort
    ' >"$output"
}
preprocess_mbedtls_macros \
  "$baseline_stage" "$macro_output_dir/baseline.macros"
preprocess_mbedtls_macros \
  "$candidate_stage" "$macro_output_dir/candidate.macros"
diff -u \
  "$macro_output_dir/baseline.macros" \
  "$macro_output_dir/candidate.macros"
printf 'Saved filtered macro outputs in %s\n' "$macro_output_dir"

candidate_stage=$(CDPATH= cd -- "$candidate_stage" && pwd)
podman run --rm \
  --volume "$candidate_stage:/stage:ro,Z" \
  "$DEVKITPPC_IMAGE" sh -ec '
    export PATH=/opt/devkitpro/devkitPPC/bin:$PATH
    powerpc-eabi-nm -g --defined-only /stage/lib/*.a |
      grep -E "mbedtls_(ssl|x509|ctr_drbg|base64|sha1)"
  '
```

When their environments are available, also run the Dolphin entropy check,
public Plex HTTPS, a Portless-backed local origin, and the physical-hardware
heap procedure. Record an unavailable external gate instead of treating it as
a pass.

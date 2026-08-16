# Watch Together harness

This is a deliberately small real-infrastructure harness. It runs two Plex viewers in one page with separate account tokens and separate Plex client identifiers. It does not use Next.js, Better Auth, application cookies, or the Multiplex route tree.

The harness exercises:

- Plex PIN authentication for two accounts
- real Plex metadata, play queues, direct streams, and universal transcode streams
- real Plex Watch Together room creation and Syncplay WebSockets
- play, pause, seek, reconnect, near-end playback, and next-episode handoff
- full browser video recording plus an `ffprobe` manifest containing every recorded frame

The shared protocol implementation still comes from `@multiplex/plex-query`. The page is only a thin HTML video adapter around `SyncplaySessionController`, which keeps the protocol primitive portable to other Multiplex clients.

## Authenticate

The root test runner resolves the correct environment file from the current or
primary worktree and performs authentication automatically:

```sh
bun run test:watch-together:web
```

The lower-level script accepts dedicated harness variables or the existing
compatibility names. It never prints credentials or tokens. See
[`docs/watch-together-testing.md`](../../docs/watch-together-testing.md) for
the complete production web, Guest Link, portable harness, and GameCube gate.

Tokens are written to `.watch-together-harness/tokens.json` with mode `0600`. That directory is ignored by Git.

## Provision GameCube QA

After refreshing the web Playwright account A session and starting Multiplex,
provision the ignored GameCube compatibility state with:

```sh
bun --filter @multiplex/watch-together-harness provision:gamecube
```

This links an isolated QA console device to account A and writes both files
with mode `0600`. It never prints Plex tokens, session cookies, or the
Multiplex device secret. It also resolves the same tested Plex server
connection and server-scoped token used by the browser harness, so the Dolphin
runner does not depend on a guessed LAN URL.

## Run interactively

```sh
bun --filter @multiplex/watch-together-harness start
```

Open `http://127.0.0.1:4318` in Google Chrome.

Override the fixture when needed:

```sh
WATCH_TOGETHER_HARNESS_SERVER_ID=server-id \
WATCH_TOGETHER_HARNESS_RATING_KEY=episode-rating-key \
bun --filter @multiplex/watch-together-harness start
```

## Run the live acceptance test

```sh
bun --filter @multiplex/watch-together-harness test:live
```

The test uses Playwright Chromium by default. Set `PLAYWRIGHT_CHANNEL=chrome` on machines with system Google Chrome, or set `WATCH_TOGETHER_HARNESS_CHROME_PATH` to a Chrome executable. Real H.264/AAC fixtures require Chrome's production media codecs.

The default gate uses authenticated direct playback so Syncplay behavior is independent of transcoder capacity. Run the offset-transcode regression gate separately:

```sh
bun --filter @multiplex/watch-together-harness test:live:transcode
```

The test has zero retries. It records the complete page to WebM and writes a sibling `frames.json` file that indexes every decoded frame. Artifacts stay under `.watch-together-harness/artifacts` and are not loaded into an agent context.

Set `WATCH_TOGETHER_HARNESS_EXTRACT_FRAMES=1` to also decode every frame to PNG. This is intentionally optional because it can use substantial disk space.

The regular `bun test` command runs only deterministic unit tests. Live Plex validation is explicit because it requires private tokens, network access, a shared Plex server, and available transcode capacity.

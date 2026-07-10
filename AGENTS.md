# Multiplex

A 3rd-party Plex client web app for synchronized watching with friends.

## Project structure

- **Monorepo** with Bun workspaces: `apps/web` (Next.js 15 app) and `packages/plex-query` (Plex API client library)
- Package manager & runtime: **Bun** (lockfile: `bun.lock`)
- **Data layer**: Effect v4 HttpApi at `/api/effect` with `@effect/atom-react` (`AtomHttpApi`) client atoms in `apps/web/src/lib/effect/`; server handlers in `apps/web/src/server/effect-api/`

## Commands

All commands are run from the workspace root via `bun run <script>`:

| Task         | Command                                                |
| ------------ | ------------------------------------------------------ |
| Install deps | `bun install`                                          |
| Dev server   | `bun dev` (starts Next.js with Turbopack on port 3000) |
| Lint         | `bun run lint` (ESLint + oxlint)                       |
| Format check | `bun run format:check` (Prettier + oxfmt)              |
| Type check   | `bun run typecheck` (runs tsc across all workspaces)   |
| All checks   | `bun run check` (lint + format + typecheck)            |
| DB push      | `bun db:push` (syncs Drizzle schema to SQLite)         |
| DB studio    | `bun db:studio` (opens Drizzle Studio)                 |

## Commit messages

- Use Conventional Commit syntax with a scope: `type(scope): summary`.
- Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Prefer focused scopes such as `watch-together`, `plex-query`, or `media-player`.
- Example: `fix(watch-together): handle Plex friends without usernames`.

## Effect v4 conventions

Multiplex uses Effect v4 for Watch Together session architecture and the Plex data API:

- **Unit tests stay on `bun test`** (no vitest in this repo). Run `bun run test` from the root or `bun test` inside a workspace. Effect suites run effects via `Effect.runPromise` and use `TestClock` from `effect/testing` for timer determinism (see `.agents/skills/effect-bun-tests`).
- **Agent skills** for Effect discipline live under `.agents/skills/effect-*` (`effect-typed-errors`, `effect-schema-boundaries`, `effect-bun-tests`, `effect-atom-optimistic`, `effect-atom-reactivity-keys`, `effect-promise-exit`).
- **Reference clones**: `bun run pull:references` shallow-clones Effect, effect-atom, and executor into gitignored `.reference/` for pattern lookup.
- **Escape-hatch lint**: oxlint rule `multiplex/no-effect-escape-hatch` (plugin in `scripts/oxlint-plugin-multiplex/`) flags `Effect.runPromise` / `runSync` / `runFork` / `runPromiseExit` outside designated boundary files. Root oxlint currently covers packages/scripts only (`apps/web` uses ESLint); see the plugin README for coverage details.
- **HttpApi + atoms**: server groups/handlers under `apps/web/src/server/effect-api/`; client atoms and `WatchTogetherApi` under `apps/web/src/lib/effect/`. RSC pages call `~/server/queries/*` directly when they need initial data.

## Cursor Cloud specific instructions

### Environment setup

- Bun must be installed (`curl -fsSL https://bun.sh/install | bash`). The binary lands at `~/.bun/bin/bun` — ensure `$HOME/.bun/bin` is on PATH.
- After `bun install`, create `apps/web/.env` from `apps/web/.env.example` and fill in `BETTER_AUTH_SECRET` (use `openssl rand -hex 32`). The default `DATABASE_URL=file:./db.sqlite` and `BETTER_AUTH_URL=http://localhost:3000` work for local dev.
- Run `bun db:push` to initialize the SQLite database before starting the server.

### Running the dev server

- `bun dev` starts Next.js 15 with Turbopack on `http://localhost:3000`.
- The app redirects unauthenticated users to `/login`. The login flow uses Plex OAuth (PIN-based), requiring internet access to `plex.tv`.

### Testing with Plex account

- Secrets `MULTIPLEX_ACCOUNT_EMAIL` and `MULTIPLEX_ACCOUNT_PASSWORD` provide Plex credentials for end-to-end login testing via the Plex OAuth flow.

### Watch Together end-to-end tests (Playwright)

- Located in `apps/web/e2e`. Run with `bun run --filter @multiplex/web test:e2e` (or `test:e2e:setup` to just authenticate). They drive two real Plex accounts through the plex.tv login and verify the lobby auto-starts and both viewers play the same item in sync.
- Requires a running dev server (the config reuses an existing one on port 3000), internet access to `plex.tv`, and these account env vars:
  - Host (account A): `AUGUSDOGUS_ACCOUNT_USERNAME` / `AUGUSDOGUS_ACCOUNT_PASSWORD`
  - Guest (account B): `MULTIPLEX_ACCOUNT_EMAIL` / `MULTIPLEX_ACCOUNT_PASSWORD`
- Uses the system Google Chrome (`channel: "chrome"`) because Plex streams are H.264/AAC, which Playwright's bundled Chromium cannot decode.
- Covers simultaneous auto-start, pause/resume sync, and seek sync. Helpers that need authenticated API calls hit `/api/effect/*` (session cookie from storageState). Because these hit a live Plex server (real transcoding for two viewers), the config allows one retry for transient startup flakiness.

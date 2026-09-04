# Multiplex

A 3rd-party Plex client web app for synchronized watching with friends.

## Project structure

- **Monorepo** with Bun workspaces: `apps/web` (Next.js 16 preview app) and `packages/plex-query` (Plex API client library)
- Package manager & runtime: **Bun** (lockfile: `bun.lock`)
- **Ownership**: Effect v4 `PlayerService` and `WatchTogetherSession` own canonical player/session runtime state; tRPC + TanStack Query + SuperJSON own Plex server data and RSC hydration; Zustand is limited to persisted preferences and unrelated local UI state; do not introduce Jotai

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

## Multiplex friction is product work

When a supported Multiplex workflow exposes a reproducible defect in Multiplex-owned code, or returns an error that leaves a fresh agent unable to recover, keep the failing case and treat the defect as part of the current task. Minimize it and reproduce it against the current default branch before starting a repair. Keep the calling code honest instead of hiding the defect with a local workaround. A change that chooses new product semantics, crosses into another repository or submodule, or turns an unsupported request into a feature needs approval first.

For a confirmed Multiplex defect, follow [`.agents/skills/repair-friction/SKILL.md`](.agents/skills/repair-friction/SKILL.md). This is standing authorization to fix Multiplex-owned code, create or update a dedicated branch and pull request, and babysit its current head until required checks pass and no actionable review thread remains. It does not authorize merging the pull request.

When delegation is available and the repair can be separated from the original task, dispatch that skill to one subagent in an isolated worktree. The discovering agent owns the diagnosis, minimized reproduction, and final retest. The repair agent owns the regression test, root-cause fix, branch, pull request, and review loop. The discovering agent must receive the repair evidence and rerun the original workflow before reporting its task complete. Run the same skill directly when delegation is unavailable or the work cannot be separated cleanly.

## Effect v4 conventions

Multiplex uses Effect v4 for canonical media-player state and Watch Together session orchestration:

- **Unit tests stay on `bun test`** (no vitest in this repo). Run `bun run test` from the root or `bun test` inside a workspace. Effect suites run effects via `Effect.runPromise` and use `TestClock` from `effect/testing` for timer determinism (see `.agents/skills/effect-bun-tests`).
- **Agent skills** for Effect discipline live under `.agents/skills/effect-*` (`effect-typed-errors`, `effect-schema-boundaries`, and `effect-bun-tests`).
- **Runtime boundaries stay narrow**: keep `Effect.runPromise`, `runSync`, `runFork`, and `runPromiseExit` in tests, runtime bootstraps, or true adapter boundaries rather than domain code.
- **Do not duplicate runtime state**: `PlayerService` and `WatchTogetherSession` are canonical. `player-prefs-store` persists volume, mute, playback rate, captions, and autoplay preference only. Plex queries and mutations remain on tRPC/TanStack Query with SuperJSON and RSC hydration.

## Cursor Cloud specific instructions

### Environment setup

- Bun must be installed (`curl -fsSL https://bun.sh/install | bash`). The binary lands at `~/.bun/bin/bun` — ensure `$HOME/.bun/bin` is on PATH.
- After `bun install`, create `apps/web/.env` from `apps/web/.env.example` and fill in `BETTER_AUTH_SECRET` (use `openssl rand -hex 32`). The default `DATABASE_URL=file:./db.sqlite` and `BETTER_AUTH_URL=http://localhost:3000` work for local dev.
- Run `bun db:push` to initialize the SQLite database before starting the server.

### Running the dev server

- `bun dev` starts the Next.js 16 preview with Turbopack on `http://localhost:3000`.
- The app redirects unauthenticated users to `/login`. The login flow uses Plex OAuth (PIN-based), requiring internet access to `plex.tv`.

### Testing with Plex account

- Secrets `MULTIPLEX_ACCOUNT_EMAIL` and `MULTIPLEX_ACCOUNT_PASSWORD` provide Plex credentials for end-to-end login testing via the Plex OAuth flow.

### Watch Together end-to-end tests (Playwright)

- Located in `apps/web/e2e`. Run with `bun run --filter @multiplex/web test:e2e` (or `test:e2e:setup` to just authenticate). They drive two real Plex accounts through the plex.tv login and verify the lobby auto-starts and both viewers play the same item in sync.
- Requires a running dev server (the config reuses an existing one on port 3000), internet access to `plex.tv`, and these account env vars:
  - Host (account A): `MULTIPLEX_ACCOUNT_EMAIL` / `MULTIPLEX_ACCOUNT_PASSWORD`
  - Guest (account B): `MUTLIPLEX_ACCOUNT_EMAIL_2` / `MULTIPLEX_ACCOUNT_PASSWORD_2`
- Uses the system Google Chrome (`channel: "chrome"`) because Plex streams are H.264/AAC, which Playwright's bundled Chromium cannot decode.
- Covers simultaneous auto-start, pause/resume sync, and seek sync. Because these hit a live Plex server (real transcoding for two viewers), the config allows one retry for transient startup flakiness.

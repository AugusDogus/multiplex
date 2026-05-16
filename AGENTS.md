# Multiplex

A 3rd-party Plex client web app for synchronized watching with friends.

## Project structure

- **Monorepo** with Bun workspaces: `apps/web` (Next.js 15 app) and `packages/plex-query` (Plex API client library)
- Package manager & runtime: **Bun** (lockfile: `bun.lock`)

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

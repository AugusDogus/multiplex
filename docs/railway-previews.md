# PR previews via GitHub Actions → Railway (Docker)

**Orchestration lives in GitHub Actions.** The root `Dockerfile` is a normal
portable image with no Railway-specific behavior. Actions uses the Railway CLI
to create a per-PR environment, `railway up` the PR head (remote Docker build),
set `BETTER_AUTH_URL` to that environment’s public domain, and delete the
environment when the PR closes.

Preview URLs are for **manual smoke / login**, not full Watch Together e2e
(that still needs dual Plex accounts + Chrome).

## Architecture

```text
PR opened / synced          PR closed
        │                        │
        ▼                        ▼
GitHub Actions              GitHub Actions
  checkout PR head            railway environment delete pr-N
  railway environment new
  ensure public domain
  set BETTER_AUTH_URL
  railway up  ──Docker──►  Railway service in env pr-N
```

Do **not** enable Railway’s native “PR Environments” for this repo if you are
using this workflow — you would get duplicate preview stacks.

## One-time setup

### 1. Railway project

1. Create a Railway project with one web service.
2. Point the service at Docker builds (root `Dockerfile` / `railway.toml`).
3. On a **base** environment (e.g. `preview-base` or staging), set at least:

   | Variable | Value |
   |----------|--------|
   | `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
   | `DATABASE_URL` | `file:/app/data/db.sqlite` (image default) |

   `BETTER_AUTH_URL` is **set per PR by Actions** after a domain exists — you
   do not need a stable value on the base env for previews.

4. Note the **project id**, **base environment id**, and **service id**
   (Railway dashboard → settings / `railway status --json`).

### 2. GitHub configuration

| Name | Where | Purpose |
|------|--------|---------|
| `RAILWAY_TOKEN` | Actions **secret** | Account API token (not a project token) |
| `RAILWAY_PROJECT_ID` | Actions **variable** | Project id |
| `RAILWAY_ENVIRONMENT_ID` | Actions **variable** | Base env id to `--copy` |
| `RAILWAY_SERVICE_ID` | Actions **variable** | Service id to deploy |

Workflow: `.github/workflows/railway-preview.yml`

### 3. Safety defaults (already in the workflow)

- **Same-repo only** — fork PRs never deploy or destroy
- **Cleanup on close/merge** — deletes `pr-<number>`
- **Optional approval** — create a GitHub Environment `railway-preview` with
  required reviewers and uncomment `environment: railway-preview` in the
  workflow

Keep Railway’s **Bot PR Environments** disabled; this workflow does not run
for `pull_request` events from bots unless they open PRs in-repo (still gated
by your token).

## Local Docker smoke test (no Railway)

```bash
docker build -t multiplex:local .
docker run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  multiplex:local
```

Open `http://localhost:3000/login`.

## Limits

- SQLite on the container filesystem is ephemeral unless you mount `/app/data`
- Plex OAuth needs outbound access to `plex.tv`
- Until the four GitHub secrets/vars above are set, the workflow **skips**
  with a notice (so open PRs stay green before Railway is wired)

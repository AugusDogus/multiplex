# PR previews via GitHub Actions → Railway (Docker)

**Orchestration lives in GitHub Actions.** The root `Dockerfile` is a normal
portable image with no Railway-specific behavior.

## Do we need the Railway CLI in Actions?

Yes, if Actions is what creates/deploys/deletes preview environments. Something
in the job has to call Railway’s API; the CLI is the supported client. That is
**not** a Docker dependency — the image never installs or calls Railway.

What you store in GitHub is only a **token** (and project/service ids). The
workflow installs the CLI at job runtime to use that token.

Alternative with **no** Actions CLI/token: enable Railway’s native GitHub
“PR Environments” in the Railway dashboard (Railway’s GitHub app does the
work). Do **not** enable that if you use this workflow, or you will get
duplicate stacks.

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

## One-time setup

### Railway project (already created for Multiplex)

| | ID |
|-|----|
| Project | `c4c3d699-caab-4ce6-928a-d00b41af3c8b` |
| Base environment (`production`) | `710ec0ab-66f4-487d-b6eb-c605aa27e5cb` |
| Service (`web`) | `cfa2c372-51ef-4a28-8740-3f95b634e4c4` |

Base env should have at least:

| Variable | Value |
|----------|--------|
| `BETTER_AUTH_SECRET` | random 32+ bytes |
| `DATABASE_URL` | `file:/app/data/db.sqlite` |

`BETTER_AUTH_URL` is set **per PR by Actions** after a domain exists.

### GitHub secrets / variables

Needs a repo admin (or a `gh` token with `secrets:write` / Actions variables).
The Cursor cloud agent token is **not** allowed to set these (GitHub 403).

```bash
# Account/workspace API token (Railway → Account → Tokens), NOT the short-lived CLI login cookie.
# If an agent already minted one into a local file:
gh secret set RAILWAY_TOKEN < /tmp/multiplex-railway-api-token
gh secret set RAILWAY_API_TOKEN < /tmp/multiplex-railway-api-token

gh variable set RAILWAY_PROJECT_ID --body c4c3d699-caab-4ce6-928a-d00b41af3c8b
gh variable set RAILWAY_ENVIRONMENT_ID --body 710ec0ab-66f4-487d-b6eb-c605aa27e5cb
gh variable set RAILWAY_SERVICE_ID --body cfa2c372-51ef-4a28-8740-3f95b634e4c4
```

Or set the same values in GitHub → Settings → Secrets and variables → Actions.

Workflow: `.github/workflows/railway-preview.yml`

### Safety defaults (already in the workflow)

- **Same-repo only** — fork PRs never deploy or destroy
- **Cleanup on close/merge** — deletes `pr-<number>`
- **Optional approval** — create a GitHub Environment `railway-preview` with
  required reviewers and uncomment `environment: railway-preview` in the workflow

Until the secrets/vars above exist, the workflow **skips** with a notice.

## Local Docker smoke test (no Railway)

```bash
docker build -t multiplex:local .
docker run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  multiplex:local
```

## Limits

- SQLite on the container filesystem is ephemeral unless you mount `/app/data`
- Plex OAuth needs outbound access to `plex.tv`

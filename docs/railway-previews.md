# Railway Docker deploys & PR previews

Multiplex ships a root `Dockerfile` and `railway.toml` so Railway builds with
Docker (not Railpack). Preview URLs are meant for **manual smoke / login**, not
full Watch Together e2e (that still needs dual Plex accounts + Chrome).

## Prerequisites

1. Railway CLI (local):

   ```bash
   curl -fsSL https://railway.com/install.sh | sh
   export PATH="$HOME/.railway/bin:$PATH"
   railway login
   ```

2. A Railway project linked to this GitHub repo (service root = repo root so
   the root `Dockerfile` is detected).

3. Service variables on the **base** environment (usually production or a
   dedicated `preview-base` / staging env that PR environments copy from):

   | Variable | Value |
   |----------|--------|
   | `BETTER_AUTH_SECRET` | `openssl rand -hex 32` (shared across previews is fine) |
   | `DATABASE_URL` | `file:/app/data/db.sqlite` (default in the image) |
   | `BETTER_AUTH_URL` | optional on Railway — entrypoint sets `https://$RAILWAY_PUBLIC_DOMAIN` when that var exists |

4. Generate a public Railway domain on the service (PR envs get their own
   domains when the base service has a Railway-provided domain).

## Enable PR Environments (recommended)

Railway’s native PR Environments already match the product goals:

- Created when a PR opens against the linked repo
- **Deleted when the PR is merged or closed**
- **Fork PRs are not deployed** unless that GitHub user is invited to the Railway project
- Bot PRs are off by default (`Enable Bot PR Environments` stays unchecked)

Steps:

1. Railway → Project Settings → **Environments** → **Enable PR Environments**
2. Optionally enable **Focused PR Environments** (watch paths already listed in
   `railway.toml`)
3. Leave **Bot PR Environments** disabled unless you want Dependabot/etc. previews
4. Set the PR base environment to staging/`preview-base` if you do not want
   production variables as the template

No GitHub Actions secret is required for the native path.

## Optional: GitHub Actions + Railway CLI

`.github/workflows/railway-preview.yml` is an optional alternative that creates
`pr-<number>` environments via the CLI and deletes them on close. Use it only if
you need custom wiring; otherwise prefer native PR Environments.

Required GitHub secrets / variables (Actions path only):

| Name | Type | Purpose |
|------|------|---------|
| `RAILWAY_TOKEN` | secret | Account token (not a project token) |
| `RAILWAY_PROJECT_ID` | variable or secret | Project id |
| `RAILWAY_ENVIRONMENT_ID` | variable or secret | Base env to `--copy` |
| `RAILWAY_SERVICE_ID` | variable or secret | Service whose `source.branch` is pointed at the PR |

The workflow **skips fork PRs** and only runs for `pull_request` events on this
repository. To require human approval as well, add a GitHub Environment named
`railway-preview` with required reviewers and uncomment the `environment:` key
in the workflow.

## Local Docker smoke test

```bash
docker build -t multiplex:local .
docker run --rm -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  multiplex:local
```

Then open `http://localhost:3000/login`.

## Limits

- SQLite on the container filesystem is **ephemeral** unless you attach a volume
  at `/app/data`. Previews reset auth/session data on each redeploy without a volume.
- Plex OAuth still needs outbound access to `plex.tv`.
- Preview `BETTER_AUTH_URL` must match the public HTTPS hostname (handled by the
  entrypoint on Railway).

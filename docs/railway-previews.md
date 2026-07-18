# Railway PR previews (Docker + GitHub)

**Idiomatic setup: Railway’s native PR Environments.** Connect this GitHub repo
to a Railway service that builds from the root `Dockerfile`. Railway creates a
preview environment per PR, builds Docker from the PR branch, comments on the
PR, and deletes the environment when the PR closes. No GitHub Actions deploy
job is required.

The Docker image stays host-agnostic (`BETTER_AUTH_URL` / `BETTER_AUTH_SECRET`).
Railway injects those as service variables (including
`BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` so each preview gets the
right public origin).

## One-time setup

### 1. Railway project + service

Already created for this repo:

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| Project       | `multiplex` (`c4c3d699-caab-4ce6-928a-d00b41af3c8b`) |
| Service       | `web` (`cfa2c372-51ef-4a28-8740-3f95b634e4c4`)       |
| Base env      | `production` (variable seed only; not auto-deployed) |
| GitHub source | `AugusDogus/multiplex` (PR Environments only)        |

Service variables on the base env (copied into each PR environment):

| Variable             | Value                                |
| -------------------- | ------------------------------------ |
| `BETTER_AUTH_SECRET` | random secret                        |
| `DATABASE_URL`       | `file:/app/data/db.sqlite`           |
| `BETTER_AUTH_URL`    | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |

`railway.toml` at the repo root selects the Dockerfile builder.

### 2. No production deploy from `main`

Production is intentionally **not** a live site:

- Auto-deploy for the production service instance is off
- The `main` → production GitHub deployment trigger is removed
- The production public domain is removed

Merges to `main` should not create a public Railway deployment. The production
environment still exists as the **base** that PR Environments copy variables
from. Keep the GitHub repo connected on the service so Railway can open
ephemeral PR environments; do not re-add a `main` branch trigger unless you
want production deploys again.

### 3. PR Environments (enabled)

Already enabled on the `multiplex` project:

| Setting                       | Value        |
| ----------------------------- | ------------ |
| PR Environments (`prDeploys`) | on           |
| Bot PR Environments           | off          |
| Focused PR Environments       | on           |
| Base environment              | `production` |

Railway only deploys PRs from users who can access the project (fork drive-bys
are skipped). Environments are removed when the PR is merged or closed.

To change these later: Railway → Project Settings → **Environments**, or the
`projectUpdate` GraphQL mutation.

### 4. Preview access (public URLs)

Railway does **not** offer Vercel-style password protection on preview URLs.
Anyone with the `*.up.railway.app` link can hit the HTTP surface. Multiplex
still requires Plex login before anything useful loads, which is enough for
this project’s risk profile.

If you later need a hard gate in front of previews, put Cloudflare Access (or
similar) in front of the Railway domain — that is outside Railway’s product.

### 5. GitHub secrets (optional / unused for native previews)

If you previously set `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` and the project id
variables for an Actions-based workflow, you can delete them — native PR
Environments use the Railway ↔ GitHub app connection instead.

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
- Previews are for manual smoke/login, not full Watch Together e2e
- Preview URLs are public; protect via app auth (or an external edge gate)

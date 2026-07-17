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

|               |                                                       |
| ------------- | ----------------------------------------------------- |
| Project       | `multiplex` (`c4c3d699-caab-4ce6-928a-d00b41af3c8b`)  |
| Service       | `web` (`cfa2c372-51ef-4a28-8740-3f95b634e4c4`)        |
| Base env      | `production` (`710ec0ab-66f4-487d-b6eb-c605aa27e5cb`) |
| GitHub source | `AugusDogus/multiplex` @ `main`                       |

Service variables on the base env:

| Variable             | Value                                |
| -------------------- | ------------------------------------ |
| `BETTER_AUTH_SECRET` | random secret                        |
| `DATABASE_URL`       | `file:/app/data/db.sqlite`           |
| `BETTER_AUTH_URL`    | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |

`railway.toml` at the repo root selects the Dockerfile builder.

### 2. Enable PR Environments (dashboard)

1. Open the Railway project → **Settings** → **Environments**
2. **Enable PR Environments**
3. Leave **Bot PR Environments** off (Dependabot/etc. won’t get previews)
4. Optionally enable **Focused PR Environments**

Railway will only deploy PRs from users who can access the Railway project
(fork drive-bys are not deployed). Environments are removed when the PR is
merged or closed.

### 3. GitHub secrets (optional / unused for native previews)

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

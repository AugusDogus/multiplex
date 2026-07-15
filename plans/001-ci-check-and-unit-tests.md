# Plan 001: Add GitHub Actions CI for check + unit tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3c8182d..HEAD -- .github package.json apps/web/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction / dx
- **Planned at**: commit `3c8182d`, 2026-07-15

## Why this matters

There is **no** `.github/workflows` directory and no Dockerfile / Railway /
preview deploy config. Every PR currently relies on local discipline. The
maintainer wants PR preview deployments later; those are useless without a
baseline CI gate. This plan adds a minimal Actions workflow that runs the
repo's existing `bun run check` and `bun run test` (unit tests only — not
Playwright e2e, which need live Plex + Chrome + secrets).

## Current state

- Root scripts (`package.json`):
  - `"check": "bun run lint && bun run format:check && bun run typecheck"`
  - `"test": "bun --filter '*' test"`
- `@multiplex/web` unit tests: `"test": "bun test"` in `apps/web/package.json`
- E2E is separate: `test:e2e` / Playwright + system Chrome + Plex accounts
  (`AGENTS.md`) — **out of scope for this CI job**
- No `.github/` tree exists at planned-at SHA
- Package manager: **Bun** (lockfile `bun.lock`)

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install` | exit 0 |
| Check | `bun run check` | exit 0 |
| Unit tests | `bun run test` | exit 0 |
| Lint only | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (create)
- `plans/README.md` status row for 001 only

**Out of scope**:
- Playwright e2e in CI
- Docker / Railway / PR preview environments
- Deploy workflows
- Changing lint/format/typecheck scripts themselves (fix failures if found;
  do not weaken gates)

## Git workflow

- Branch: match the operator's convention (e.g. `cursor/ci-baseline-…`)
- Commits: Conventional Commits with scope, e.g. `ci(web): add check and unit test workflow`
- Example from history: `fix(watch-together): handle Plex friends without usernames`

## Steps

### Step 1: Create the workflow

Create `.github/workflows/ci.yml` that:

1. Triggers on `pull_request` and `push` to `main`
2. Runs on `ubuntu-latest`
3. Checks out the repo
4. Installs Bun (use `oven-sh/setup-bun@v2` or current equivalent; pin a major)
5. Runs `bun install --frozen-lockfile` (if Bun rejects the flag on this
   lockfile version, fall back to `bun install` and note it in the PR)
6. Runs `bun run check`
7. Runs `bun run test`

Keep it to **one job** named `check` (or `ci`). Do not add matrix builds,
caching gymnastics, or concurrency groups unless install is painfully slow
after a first green run.

Example shape (adjust action versions if newer majors exist at execution time):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run test
```

**Verify**: `test -f .github/workflows/ci.yml` → file exists; `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` if PyYAML is available, else visually confirm valid YAML indentation.

### Step 2: Run the same commands locally

**Verify**: `bun install` → exit 0; `bun run check` → exit 0; `bun run test` → exit 0.

If `check` or `test` fails on `main` before your workflow change, **STOP** and
report — do not disable failing checks to make CI green.

### Step 3: Update the plans index

Set plan 001 status to DONE in `plans/README.md`.

**Verify**: `rg '001.*DONE' plans/README.md` → match.

## Test plan

- No new application tests.
- CI itself is the verification: workflow must invoke the same scripts
  developers run locally.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists and runs `bun install`, `bun run check`, `bun run test`
- [ ] Workflow does **not** run Playwright e2e
- [ ] `bun run check` and `bun run test` exit 0 locally
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 001 is DONE

## STOP conditions

- `bun run check` or `bun run test` fails on an otherwise clean tree before CI changes
- Repo already gained a different CI workflow since planned-at (reconcile, don't duplicate)
- Someone asks you to add Docker/Railway preview as part of this plan — that is a separate deferred item

## Maintenance notes

- When adding PR previews later, keep this job as the merge gate; previews are optional and flaky without Plex.
- If format/lint become too slow, split jobs — do not drop format:check.
- Reviewers should confirm e2e was intentionally omitted.

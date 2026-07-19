# Plan 008: Speed Plex image proxy hot path and stop dual-hero downloads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 38dbd82..HEAD -- apps/web/src/server/plex-image.ts apps/web/src/app/api/plex/image/route.ts apps/web/src/components/media-item-details/details-hero.tsx apps/web/next.config.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (SSRF / auth boundaries on the image route are security-critical)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `38dbd82`, 2026-07-19

## Why this matters

Browse and details pages request many `/api/plex/image?...` URLs. Each request:

1. Runs `auth.api.getSession`
2. Loads servers via `getServersQuery`
3. Walks connections **sequentially** in `handlePlexImageRequest` (does **not**
   use `PlexServerClient`'s raced working-URI cache)

Also `next.config.js` sets `images: { unoptimized: true }` (required because the
optimizer would strip cookies — keep that). Details hero mounts **both** desktop
and mobile `priority` backdrops/posters; CSS `hidden` does not cancel the
download, so every details view pays ~2× hero image bytes.

## Current state

```ts
// apps/web/src/app/api/plex/image/route.ts
authenticate: async (imageRequest) => {
  const session = await auth.api.getSession({ headers: imageRequest.headers });
  // ...
  return { token, servers: await getServersQuery(plex) };
},
```

```ts
// apps/web/src/server/plex-image.ts — sequential fallback
for (const connection of connections) {
  upstream = await dependencies.fetch(upstreamUrl, { ... });
  // ...
}
```

```tsx
// apps/web/src/components/media-item-details/details-hero.tsx
<section className="... hidden ... lg:block">  {/* priority backdrop + poster */}
<section className="... lg:hidden">           {/* priority backdrop + poster again */}
```

Existing tests: `apps/web/src/server/plex-image.test.ts` — extend these; do not
weaken SSRF allowlists in `~/lib/plex-image`.

## Commands you will need

| Purpose   | Command                                           | Expected on success |
| --------- | ------------------------------------------------- | ------------------- |
| Tests     | `bun test apps/web/src/server/plex-image.test.ts` | all pass            |
| Typecheck | `bun run typecheck`                               | exit 0              |
| Lint      | `bun run lint`                                    | exit 0              |

## Scope

**In scope**:

- `apps/web/src/server/plex-image.ts` (+ tests)
- `apps/web/src/app/api/plex/image/route.ts`
- `apps/web/src/components/media-item-details/details-hero.tsx`
- Optionally reuse working-URI helpers from `packages/plex-query` **without**
  expanding the public image URL attack surface

**Out of scope**:

- Re-enabling Next image optimization (`unoptimized: true` stays)
- Changing artwork path allowlists except for bugfixes discovered by tests
- CDN / R2 offload (direction only; not this plan)

## Git workflow

- Commits: `perf(images): reuse working URI on proxy` /
  `perf(details): render one hero image tree`
- Do NOT open a PR unless instructed.

## Steps

### Step 1: Prefer cached working connection for image fetches

Wire the image route to try the known-good PMS URI first (same process-wide
cache `PlexServerClient` uses after `warmConnection` / identity race). Keep
sequential/ranked fallback for cold cache. Preserve redirect rejection,
content-type allowlist, and byte limits.

**Verify**: `bun test apps/web/src/server/plex-image.test.ts` → all pass,
including connection fallback coverage.

### Step 2: Reduce per-image auth overhead where safe

Acceptable approaches (pick the smallest that helps):

- Deduplicate session+servers work across concurrent image requests in the same
  isolate (short TTL in-memory memo keyed by session cookie hash — **never log
  tokens**).
- Or pass through `getServersQuery` only (already `"use cache"` minutes) and
  ensure session lookup is not repeated more than necessary.

Do **not** put raw plex tokens into durable cache keys outside the existing
`"use cache"` pattern documented in `get-servers.ts`.

**Verify**: existing plex-image tests still pass; `bun run typecheck` → exit 0

### Step 3: Single responsive hero tree

Refactor `details-hero.tsx` so only one backdrop and one poster are in the DOM
(or only one has `priority` / is mounted), using responsive CSS or a
`useMediaQuery`-style client split that does not mount the inactive tree.

Watch Together lobby (`watch-together-lobby.tsx`) has a similar dual `priority`
pattern — fix details first; only touch lobby if the change is trivial and
identical.

**Verify**: `rg -n "priority" apps/web/src/components/media-item-details/details-hero.tsx` — at most one backdrop and one poster use `priority` for a given viewport mount.

### Step 4: Lint + typecheck

**Verify**: `bun run lint && bun run typecheck` → exit 0

## Test plan

- Extend `plex-image.test.ts` for “cached working URI tried first”.
- No screenshot tests required.

## Done criteria

- [ ] Image proxy uses working-URI cache / race-friendly first hop
- [ ] Details hero does not download both mobile and desktop priority art
- [ ] SSRF/auth tests green
- [ ] README status DONE

## STOP conditions

- Any change that would fetch arbitrary user-supplied URLs or forward redirects
  — STOP immediately.
- If sharing working-URI cache requires exporting unsafe internals from
  plex-query, STOP and propose a narrow `getCachedWorkingUri(serverId)` API
  instead of copying connection lists into the web app ad hoc.

## Maintenance

Image security rules live in `~/lib/plex-image` + `handlePlexImageRequest`.
Perf changes must keep the private `Cache-Control` + `Vary: Cookie` semantics
unless deliberately designing a public CDN strategy (out of scope).

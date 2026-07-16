# Plan 002: Spike — make browse as fast as Plex web on the current stack

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 43e847c..HEAD -- apps/web/src/app/(app)/page.tsx apps/web/src/lib/plex-hub-query-options.ts apps/web/src/components/continue-watching.tsx apps/web/src/trpc/query-client.ts AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (spike + small wins; not a multi-week rewrite)
- **Risk**: MED (stale Continue Watching / hubs if caching is too aggressive)
- **Depends on**: none (CI already on main)
- **Category**: direction / perf
- **Planned at**: commit `43e847c`, 2026-07-16 (refreshed; was `3c8182d`)

## Why this matters

The #1 maintainer goal is “as fast as / faster than official Plex web.” Today
Multiplex is a Plex *client*: browse data flows **RSC → tRPC → plex-query →
plex.tv/PMS**, hydrated into TanStack Query. Home **awaits three prefetches**
before paint, hub queries force `staleTime: 0` (immediate client refetch after
SSR), and Continue Watching polls every ~5s through Multiplex. A Zero /
Electric / TanStack DB sync engine does **not** remove the Plex network hop and
conflicts with the settled ownership model (Effect owns player/session;
tRPC + TanStack Query own Plex server data — see `AGENTS.md` and deferred
Phase 5 in `plans/effect-v4-migration.md`).

This plan is a **design + measurement spike** that must produce a short
write-up and **may** land 1–3 low-risk cache/prefetch tweaks if measurements
justify them. It must **not** introduce a sync engine.

## Current state

### Ownership (do not violate)

From `AGENTS.md`: Effect v4 `PlayerService` / `WatchTogetherSession` own
canonical player/session runtime; tRPC + TanStack Query + SuperJSON own Plex
server data; Zustand is prefs/local UI only.

### Home blocks on prefetch

`apps/web/src/app/(app)/page.tsx`:

```tsx
await Promise.allSettled([
  api.plex.getHomeHubs.prefetch(),
  api.plex.getAllContinueWatching.prefetch(),
  api.plex.getWatchTogetherRooms.prefetch(),
]);
```

### Hub hydrate then immediately refetch

`apps/web/src/lib/plex-hub-query-options.ts`:

```ts
export const PLEX_HUB_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnWindowFocus: false,
} as const;
```

Default QueryClient already uses `staleTime: 30_000`
(`apps/web/src/trpc/query-client.ts`). Hubs intentionally override to 0.

### Continue Watching chatty poll

`apps/web/src/components/continue-watching.tsx` uses `staleTime: 0` and
`refetchInterval` (default refresh path ~5s when auto-refresh + page visible).

### Already-good patterns to preserve

- Item details hover prefetch: `apps/web/src/hooks/use-item-details-navigation.ts`
- Details `staleTime: 5 * 60 * 1000` in `plex-details-query-options.ts`
- Virtualized poster grids, route `loading.tsx` skeletons
- Narrow Next `"use cache"` on account-level `get-servers` / `get-user-info` only
- **New on main**: `6173202` reuses healthy Plex server clients in plex-query —
  measure whether home latency is still dominated by Multiplex→PMS vs cold
  TCP; do not treat that commit as finishing this spike

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Dev server | `bun dev` | Next on :3000 |
| Typecheck | `bun run typecheck` | exit 0 |
| Check | `bun run check` | exit 0 |
| Unit tests | `bun run test` | exit 0 |

## Suggested executor toolkit

- Browser DevTools Network + Performance (or Playwright timing) against a real
  Plex account if credentials exist in the environment.
- Do **not** add Electric/Zero/TanStack DB dependencies.

## Scope

**In scope**:
- Measurement notes committed as `plans/002-browse-speed-findings.md` (create)
- Optional small code tweaks **only** to:
  - `apps/web/src/lib/plex-hub-query-options.ts`
  - `apps/web/src/components/continue-watching.tsx` (poll/staleTime only)
  - `apps/web/src/app/(app)/page.tsx` (prefetch/streaming strategy only)
  - Matching unit tests if any options helpers gain logic
- `plans/README.md` status row for 002

**Out of scope**:
- Zero, Electric, TanStack DB, Replicache, RxDB, or any local catalog replica
- Rewriting Effect `PlayerService` / Watch Together
- Client-side transcoding
- Changing Plex API client batching across all routers in one PR
- “Make it feel faster” without before/after numbers

## Git workflow

- Branch per operator convention
- Commits: `perf(web): …` for code; `docs(plans): …` for findings
- Keep findings doc and code changes reviewable (prefer findings-first commit)

## Steps

### Step 1: Baseline measurements (no code changes)

With `bun dev` and a logged-in session (use env Plex secrets if available;
otherwise document that measurement was local-only / incomplete):

Record in `plans/002-browse-speed-findings.md`:

1. **Home cold load**: time from navigation to first Continue Watching row
   content (or skeleton→content). Note waterfalls: document request to
   Multiplex `/api/trpc/...` vs direct PMS timing if visible.
2. **Home warm load** (reload within 30s): does hydrated data stick or do hubs
   immediately refetch (`staleTime: 0`)?
3. **Continue Watching**: count of `getAllContinueWatching` calls over 30s on
   an idle home tab.
4. **Poster → details**: time to interactive details after click when prefetch
   on hover ran vs cold.

Also note official Plex web on the same network for a qualitative comparison
(same library) — one paragraph is enough; do not reverse-engineer Plex.

**Verify**: `test -f plans/002-browse-speed-findings.md` and the file contains
the four numbered sections with numbers or an explicit “could not measure: …”
reason.

### Step 2: Decide interventions from data

In the findings doc, pick **at most three** of:

| Candidate | When justified | Risk |
|-----------|----------------|------|
| Raise hub `staleTime` (e.g. 30s–2m) so SSR hydrate wins | Warm home always refetches hubs immediately | Stale hubs |
| Soften Continue Watching poll (longer interval or invalidate-on-focus/play) | Idle tab hammers tRPC | Stale progress bars |
| Don't `await` all three home prefetches (stream shell / prioritize CW + WT) | Home TTFB dominated by slowest of three | Layout shift / empty WT row |
| Leave code unchanged | Numbers already acceptable / bottleneck is PMS RTT only | — |

**Verify**: findings doc ends with a “Chosen interventions” list of 0–3 items
and a one-line rationale each.

### Step 3: Implement chosen interventions (or skip)

If zero interventions: mark 002 DONE after findings only.

If implementing:

1. Prefer changing `PLEX_HUB_QUERY_OPTIONS.staleTime` over one-off overrides.
2. For Continue Watching, keep correctness: after local play progress updates,
   ensure the row still refreshes (existing mutation invalidation paths — do not
   remove invalidation).
3. For home prefetch, prefer `void` + per-component suspense/hydration patterns
   already used elsewhere; do not invent a new data library.

**Verify**: `bun run check` → exit 0; `bun run test` → exit 0.

### Step 4: After numbers (if code changed)

Re-run the same four measurements; append “After” section to findings.

**Verify**: findings doc has Before and After (or “no code change”).

### Step 5: Update plans index

Set 002 to DONE in `plans/README.md`.

## Test plan

- No new flaky e2e required for the spike.
- If you change pure timing helpers, add/adjust bun unit tests next to existing
  option helpers.
- Manually: home still shows CW + hubs + WT row; playing an item still updates
  CW within a reasonable time.

## Done criteria

- [ ] `plans/002-browse-speed-findings.md` exists with baseline measurements (or explicit blockers)
- [ ] Explicit recommendation: **no sync engine** restated with one sentence of evidence
- [ ] At most three code touch areas from the in-scope list (or zero)
- [ ] `bun run check` and `bun run test` exit 0
- [ ] No Electric/Zero/TanStack DB deps added (`rg -i 'electric|@rocicorp/zero|@tanstack/react-db' package.json apps/web/package.json` → no matches)
- [ ] `plans/README.md` 002 status DONE

## STOP conditions

- Spike expands into “build a sync engine”
- Home prefetch change requires a new state library
- Stale token-scoped cache appears possible across users — do not add Next
  `"use cache"` on hub/CW without a token cache key (see existing
  `get-servers.ts` / `get-user-info.ts` patterns)
- Measurements impossible and you were about to guess interventions — ship
  findings with blockers only

## Maintenance notes

- Phase 5 of Effect migration may revisit server-data caching later; keep
  findings doc as the baseline.
- Reviewers should reject any PR that adds a catalog replica “for speed.”
- Follow-up (separate plan): selective Next `"use cache"` for immutable
  metadata only, after this spike.

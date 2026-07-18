# Plan 002: Spike — make browse as fast as Plex web on the current stack

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ce72880..HEAD -- apps/web/src/app/(app)/page.tsx apps/web/src/lib/plex-hub-query-options.ts apps/web/src/components/continue-watching.tsx apps/web/src/trpc/query-client.ts AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (spike + small wins; not a multi-week rewrite)
- **Risk**: MED (stale Continue Watching / hubs if caching is too aggressive)
- **Depends on**: none
- **Category**: direction / perf
- **Planned at**: commit `ce72880`, 2026-07-18

## Why this matters

The #1 maintainer goal is “as fast as / faster than official Plex web.” Today
Multiplex is a Plex _client_: browse data flows **RSC → tRPC → plex-query →
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
  // Hydrated data paints immediately; stale data refetches once on mount.
  staleTime: 0,
  refetchOnWindowFocus: false,
} as const;
```

Default QueryClient already uses `staleTime: 30_000`
(`apps/web/src/trpc/query-client.ts`). Hubs intentionally override to 0.

### Continue Watching chatty poll

`apps/web/src/components/continue-watching.tsx` uses `staleTime: 0` and
`refetchInterval` defaulting to `5000` when auto-refresh + page visible.

Progress is also updated optimistically via `setData` from the media player
(`use-timeline-updates.ts`) and Continue Watching itself — so polling is not
the only freshness path. Prefer lengthening the interval or relying more on
invalidation/`setData` over removing refresh entirely.

### Already-good patterns to preserve

- Item details hover prefetch: `apps/web/src/hooks/use-item-details-navigation.ts`
- Details `staleTime: 5 * 60 * 1000` in `plex-details-query-options.ts`
- Virtualized poster grids, route `loading.tsx` skeletons
- Narrow Next `"use cache"` on account-level `get-servers` / `get-user-info` only
- plex-query reuses healthy Plex server clients (`6173202`) — measure whether
  home latency is still dominated by Multiplex→PMS vs cold TCP; do not treat
  that commit as finishing this spike

### Env / auth for measurement

- Create `apps/web/.env` from `apps/web/.env.example` if missing; set
  `BETTER_AUTH_SECRET` via `openssl rand -hex 32`. Defaults
  `DATABASE_URL=file:./db.sqlite` and `BETTER_AUTH_URL=http://localhost:3000`
  are fine.
- Run `bun db:push` before `bun dev`.
- Plex OAuth credentials may be available as env vars
  `MULTIPLEX_ACCOUNT_EMAIL` / `MULTIPLEX_ACCOUNT_PASSWORD`. Use them for a
  real logged-in session when possible. If browser login automation fails,
  still measure server-side procedure timings (see Step 1) and document the
  gap.

## Commands you will need

| Purpose    | Command             | Expected on success |
| ---------- | ------------------- | ------------------- |
| Install    | `bun install`       | exit 0              |
| DB         | `bun db:push`       | exit 0              |
| Dev server | `bun dev`           | Next on :3000       |
| Typecheck  | `bun run typecheck` | exit 0              |
| Check      | `bun run check`     | exit 0              |
| Unit tests | `bun run test`      | exit 0              |

## Suggested executor toolkit

- Browser DevTools Network + Performance, Playwright, or CDP against a real
  Plex account if credentials exist.
- Server-side timing of the three home tRPC queries is an acceptable
  measurement substitute when full UI login is blocked — still write numbers.
- Do **not** add Electric/Zero/TanStack DB dependencies.

## Scope

**In scope**:

- Measurement notes committed as `plans/002-browse-speed-findings.md` (create)
- Optional small code tweaks **only** to:
  - `apps/web/src/lib/plex-hub-query-options.ts`
  - `apps/web/src/components/continue-watching.tsx` (poll/staleTime only)
  - `apps/web/src/app/(app)/page.tsx` (prefetch/streaming strategy only)
  - Matching unit tests if any options helpers gain logic
- `plans/README.md` status row for 002 (skip if reviewer maintains index)

**Out of scope**:

- Zero, Electric, TanStack DB, Replicache, RxDB, or any local catalog replica
- Rewriting Effect `PlayerService` / Watch Together
- Client-side transcoding
- Changing Plex API client batching across all routers in one PR
- “Make it feel faster” without before/after numbers (or explicit measurement blockers)
- Files outside the in-scope list

## Git workflow

- Work on the current branch in this worktree (do not create extra branches)
- Commits: `perf(web): …` for code; `docs(plans): …` for findings
- Prefer findings-first commit, then code commit
- Push is handled by the reviewer — commit locally in the worktree

## Steps

### Step 1: Baseline measurements (no code changes)

With dependencies installed and (if possible) a logged-in session:

Record in `plans/002-browse-speed-findings.md`:

1. **Home cold load**: time from navigation to first Continue Watching row
   content (or skeleton→content). Note waterfalls: document request to
   Multiplex `/api/trpc/...` vs direct PMS timing if visible.
   _Fallback if UI login blocked_: time `getHomeHubs`,
   `getAllContinueWatching`, and `getWatchTogetherRooms` server procedures
   (or their query helpers) under a real plex token session — document method.
2. **Home warm load** (reload within 30s): does hydrated data stick or do hubs
   immediately refetch (`staleTime: 0`)?
   _Fallback_: cite the code path that forces refetch and treat as confirmed.
3. **Continue Watching**: count of `getAllContinueWatching` calls over 30s on
   an idle home tab (expect ~6 at 5s interval if polling).
4. **Poster → details**: time to interactive details after click when prefetch
   on hover ran vs cold — or note “not measured” with reason.

Also note official Plex web on the same network for a qualitative comparison
(same library) when possible — one paragraph is enough; do not reverse-engineer
Plex.

**Verify**: `test -f plans/002-browse-speed-findings.md` and the file contains
the four numbered sections with numbers or an explicit “could not measure: …”
reason.

### Step 2: Decide interventions from data

In the findings doc, pick **at most three** of:

| Candidate                                                                   | When justified                                          | Risk                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| Raise hub `staleTime` (e.g. 30s–2m) so SSR hydrate wins                     | Warm home always refetches hubs immediately             | Stale hubs                  |
| Soften Continue Watching poll (longer interval or invalidate-on-focus/play) | Idle tab hammers tRPC                                   | Stale progress bars         |
| Don't `await` all three home prefetches (stream shell / prioritize CW + WT) | Home TTFB dominated by slowest of three                 | Layout shift / empty WT row |
| Leave code unchanged                                                        | Numbers already acceptable / bottleneck is PMS RTT only | —                           |

Default recommendation if UI measurement is partial but code evidence is clear:
raise hub `staleTime` to match the QueryClient default (`30_000`) and lengthen
Continue Watching `refreshInterval` default (e.g. 30s). Only skip awaiting a
prefetch if you measured that the slowest of the three dominates TTFB.

**Verify**: findings doc ends with a “Chosen interventions” list of 0–3 items
and a one-line rationale each. Restate **no sync engine** with one sentence of
evidence.

### Step 3: Implement chosen interventions (or skip)

If zero interventions: mark 002 DONE after findings only.

If implementing:

1. Prefer changing `PLEX_HUB_QUERY_OPTIONS.staleTime` over one-off overrides.
2. For Continue Watching, keep correctness: after local play progress updates,
   ensure the row still refreshes (existing `setData` / invalidation paths —
   do not remove invalidation).
3. For home prefetch, prefer patterns already used elsewhere; do not invent a
   new data library. If dropping `await` on a prefetch, keep `HydrateClient`
   and ensure components still tolerate empty/pending states (they already use
   skeletons).

**Verify**: `bun run check` → exit 0; `bun run test` → exit 0.

### Step 4: After numbers (if code changed)

Re-run comparable measurements; append “After” section to findings. If full UI
re-measure is impossible, document expected effect (e.g. “warm hub refetch
eliminated for 30s; CW poll 5s→30s ⇒ ~6→1 calls / 30s idle”).

**Verify**: findings doc has Before and After (or “no code change”).

### Step 5: Index

Reviewer maintains `plans/README.md` — skip updating it unless you were not
dispatched by a reviewer.

## Test plan

- No new flaky e2e required for the spike.
- If you change pure timing helpers, add/adjust bun unit tests next to existing
  option helpers.
- Manually if possible: home still shows CW + hubs + WT row; playing an item
  still updates CW within a reasonable time.

## Done criteria

- [ ] `plans/002-browse-speed-findings.md` exists with baseline measurements (or explicit blockers)
- [ ] Explicit recommendation: **no sync engine** restated with one sentence of evidence
- [ ] At most three code touch areas from the in-scope list (or zero)
- [ ] `bun run check` and `bun run test` exit 0
- [ ] No Electric/Zero/TanStack DB deps added (`rg -i 'electric|@rocicorp/zero|@tanstack/react-db' package.json apps/web/package.json` → no matches)
- [ ] Commits present in the worktree for findings (+ code if any)

## STOP conditions

- Spike expands into “build a sync engine”
- Home prefetch change requires a new state library
- Stale token-scoped cache appears possible across users — do not add Next
  `"use cache"` on hub/CW without a token cache key (see existing
  `get-servers.ts` / `get-user-info.ts` patterns)
- Measurements impossible and you were about to guess interventions beyond the
  documented defaults in Step 2 — ship findings with blockers only, or apply
  only the Step 2 defaults with explicit rationale

## Maintenance notes

- Phase 5 of Effect migration may revisit server-data caching later; keep
  findings doc as the baseline.
- Reviewers should reject any PR that adds a catalog replica “for speed.”
- Follow-up (separate plan): selective Next `"use cache"` for immutable
  metadata only, after this spike.

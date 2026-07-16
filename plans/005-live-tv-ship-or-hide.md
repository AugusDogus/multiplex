# Plan 005: Ship-or-hide Live TV until channel tune exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 43e847c..HEAD -- apps/web/src/app/(app)/live-tv apps/web/src/components/tv-guide apps/web/src/components/live-tv-guide-refresh.tsx packages/plex-query/src/plex/utils/plex-utils.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (elevated on reconcile — guide kept improving, playback still absent)
- **Effort**: S (hide/flag) — **not** the full Live TV player project
- **Risk**: LOW for hide/flag; HIGH if you expand into full tune + WT
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43e847c`, 2026-07-16 (refreshed)

## Why this matters

Live TV appears as a real nav destination (sidebar routes via
`plex-utils` → `/live-tv/...`) and renders an EPG `TvGuide`. Main recently
invested in guide performance/UX (`d31df2f` reload out of read path;
`c340e87` simplify refresh; `live-tv-guide-refresh.tsx`), **but program and
channel clicks are still stubs**:

```ts
// apps/web/src/components/tv-guide/tv-guide.tsx
function handleProgramClick(program: TvGuideProgram) {
  // TODO: Open program details modal
  console.log("Program clicked:", program);
}
function handleChannelClick(channel: TvGuideChannelLineup["channel"]) {
  // TODO: Open channel menu
  console.log("Channel clicked:", channel);
}
```

plex-query has EPG/DVR fetch APIs; there is **no** tune/live stream path wired
into `PlayerService` / media-player. A browse-only Live TV entry that cannot
play (and cannot Watch Together) undercuts trust. This plan forces an explicit
product choice: **hide or feature-flag until playback exists**, unless the
operator has separately committed to a Live TV playback spike (not this plan).

## Current state

- Routes: `apps/web/src/app/(app)/live-tv/[machineIdentifier]/[providerIdentifier]/page.tsx`
  (now uses `LiveTvGuideRefresh` when the guide is empty)
- Guide UI: `apps/web/src/components/tv-guide/tv-guide.tsx` (stubs unchanged)
- Refresh UX: `apps/web/src/components/live-tv-guide-refresh.tsx` (+ unit test)
- Nav href construction: `packages/plex-query/src/plex/utils/plex-utils.ts`
  (~290–292) for `Live TV & DVR` → `/live-tv/${serverId}/...`
- EPG client methods live in `packages/plex-query` server client (getChannels /
  getGrid / getDVRs) — keep them; hiding UI does not require deleting APIs

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Check | `bun run check` | exit 0 |
| Test | `bun run test` | exit 0 |
| Find Live TV entry points | `rg -n 'live-tv|Live TV|isLiveTV' apps/web packages/plex-query --glob '*.{ts,tsx}'` | list of call sites |

## Scope

**Default path (recommended): hide / demote**

**In scope**:
- Stop linking Live TV from the primary sidebar / library source list **or**
  gate the route behind an explicit env/feature flag defaulting to **off**
- Soften any user-visible empty/stub interactions (remove `console.log` TODOs
  from click handlers if the page remains reachable via URL)
- Optional: route-level `notFound()` or redirect home when flag off
- Document the decision in `plans/005-live-tv-decision.md`
- `plans/README.md` status for 005

**Out of scope**:
- Implementing channel tune / HLS / Plex live play queue
- Watch Together for live streams
- DVR scheduling product
- Deleting plex-query EPG methods
- Full Live TV redesign

**Alternate path**: If the operator explicitly instructs “build Live TV
playback,” STOP this hide plan and report that a **new** spike plan is
required (PlayerService + stream URL + EPG now-playing). Do not invent that
spike inside this file’s steps.

## Git workflow

- Commit: `fix(web): hide Live TV nav until playback exists` (or
  `feat(web): feature-flag Live TV guide`)

## Steps

### Step 1: Inventory entry points

Run the rg command above. List in `plans/005-live-tv-decision.md`:

- Sidebar / source pin links
- Direct routes
- Any home hubs that surface Live TV

**Verify**: decision doc has the inventory list.

### Step 2: Choose mechanism

Pick one:

1. **Filter out** Live TV sources from the nav model (preferred if pins come
   from plex-query helpers), **or**
2. **Feature flag** e.g. `LIVE_TV_ENABLED` in `apps/web/src/env.js` defaulting
   false — when false, nav hidden and `/live-tv/...` redirects or notFound.

Record the choice in the decision doc.

**Verify**: decision doc states option 1 or 2 and default-off behavior.

### Step 3: Implement hide/flag

Implement the chosen mechanism with minimal churn. Keep code for the guide
page in-tree (do not delete the feature wholesale).

Remove stub `console.log` handlers if the guide remains compiled but unused,
or leave handlers no-op without logs.

**Verify**:
- `rg -n 'console\\.log\\(\"Program clicked\"' apps/web/src/components/tv-guide` → no matches (or page unreferenced and flag off)
- With flag/default off: Live TV not visible in sidebar for a server that has
  Live TV & DVR
- `bun run check` → exit 0; `bun run test` → exit 0

### Step 4: Update index

005 → DONE in `plans/README.md`.

## Test plan

- Unit-test any pure filter (“isLiveTV source excluded”) if you add one —
  model after existing plex-utils tests if present
  (`packages/plex-query/src/**/*.test.ts`).
- Manual: server with Live TV source no longer shows it (or flag on shows it).

## Done criteria

- [ ] `plans/005-live-tv-decision.md` records inventory + hide vs flag choice
- [ ] Default product experience does **not** present a dead-end Live TV guide
      as a primary nav destination
- [ ] No Live TV playback / WT scope sneaks in
- [ ] `bun run check` and `bun run test` exit 0
- [ ] `plans/README.md` 005 DONE

## STOP conditions

- Operator says “finish Live TV playback instead” — stop hide work; request a
  new playback spike plan
- Hiding Live TV requires breaking unrelated library pin types
- You are about to delete large EPG client surface “to clean up”

## Maintenance notes

- Re-enable only when `PlayerService` can play a live channel URL and the guide
  click opens playback (separate plan).
- Reviewers: ensure default remains off/hidden so WT-focused users never hit
  the stub.

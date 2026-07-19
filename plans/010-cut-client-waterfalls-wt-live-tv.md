# Plan 010: Cut Watch Together + Live TV client/server waterfalls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 38dbd82..HEAD -- apps/web/src/components/watch-together/watch-together-row.tsx apps/web/src/components/watch-together/use-watch-together-room-media.ts apps/web/src/app/(app)/live-tv apps/web/src/server/queries/get-all-channels-programming.ts apps/web/src/components/media-item-details-route.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (Live TV payload shape; WT card metadata)
- **Depends on**: none (can parallelize with 006–009)
- **Category**: perf
- **Planned at**: commit `38dbd82`, 2026-07-19

## Why this matters

Two remaining navigation waterfalls dominate non-home surfaces:

1. **Watch Together home row**: SSR prefetches rooms, then each card client-fetches
   `getItemDetails` via `useWatchTogetherRoomMedia` (N+1 after rooms resolve).
2. **Live TV page**: awaits full channel×grid fan-out (`GRID_REQUEST_CONCURRENCY = 6`)
   with fat program objects before any guide UI streams.
3. **Item details route**: `void` prefetch without await may race dehydration
   (investigate; fix if client always refetches).

## Current state

```tsx
// watch-together-row.tsx — per card
const { item, posterUrl, isPending } = useWatchTogetherRoomMedia(room.sourceUri);
```

```ts
// use-watch-together-room-media.ts
const detailsQuery = api.plex.getItemDetails.useQuery(
  { serverId: source?.serverId ?? "", ratingKey: source?.ratingKey ?? "" },
  { enabled: enabled && Boolean(source), staleTime: 60_000 },
);
```

```tsx
// live-tv/.../page.tsx
const { servers, userInfo } = await getAppPlexContext();
const channelLineupsResult = await api.plex.getServerChannelsProgramming({ ... });
```

```ts
// get-all-channels-programming.ts
const GRID_REQUEST_CONCURRENCY = 6;
// per channel: getGrid + maps Media/Image/summary fields into the RSC payload
```

```tsx
// media-item-details-route.tsx
void api.plex.getItemDetails.prefetch({ serverId, ratingKey });
return <HydrateClient>...</HydrateClient>;
```

Note: WT room `refetchInterval: 10_000` is intentional for lobby sync — do not
“fix” that to 30s without product sign-off. Home row already uses 30s.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Typecheck | `bun run typecheck` | exit 0              |
| Lint      | `bun run lint`      | exit 0              |
| Tests     | `bun run test`      | exit 0              |

## Scope

**In scope**:

- Watch Together row/media hooks + optional RSC prefetch batching for room posters
- Live TV page streaming / leaner guide DTO
- `media-item-details-route.tsx` prefetch await-or-stream decision
- Related server queries under `apps/web/src/server/queries/`

**Out of scope**:

- Product decision “ship-or-hide Live TV” (plans README item 005)
- Changing Syncplay protocol
- Sidebar `getAllServerLibraries` (handled by plan 002)

## Git workflow

- Commits may split: `perf(watch-together): prefetch room posters with rooms`,
  `perf(live-tv): stream guide shell`, `fix(details): await item details prefetch`
- Do NOT open a PR unless instructed.

## Steps

### Step 1: Eliminate WT row N+1

Preferred approaches (pick one):

A. Server-side: when returning `getWatchTogetherRooms`, include poster path +
title fields needed for the card (from a lightweight metadata call batched
with concurrency), so the row needs no `getItemDetails`.
B. RSC: after prefetching rooms, `Promise.all` prefetch `getItemDetails` for
each room's parsed `sourceUri` before `HydrateClient` on the home WT lane.
C. Client: `useQueries` batch is still N requests — only acceptable if paired
with http batching already present (`httpBatchStreamLink`) **and** SSR
hydration of those queries.

Prefer A or B so posters paint with the rooms payload.

**Verify**: home WT cards do not mount an enabled `getItemDetails` query before
rooms hydration provides art — `rg -n "useWatchTogetherRoomMedia" apps/web/src/components/watch-together`.

### Step 2: Stream Live TV guide

- Split page: shell (title/server check) Suspense → guide data Suspense.
- Slim the DTO: drop unused `summary` / nested `Image` / heavy `Media` fields
  from the guide read model if the `TvGuide` UI does not need them (confirm by
  reading `apps/web/src/components/tv-guide/`).
- Keep concurrency helper; do not raise concurrency blindly (can melt PMS).

**Verify**: `bun run typecheck` → exit 0; guide still renders channel rows.

### Step 3: Fix item details prefetch race

Confirm whether `void prefetch` + dehydrate-pending actually completes. If the
client refetches on every navigation despite hover prefetch:

- `await` the prefetch in `MediaItemDetailsRoute`, **or**
- Keep streaming but ensure the query is seeded via `HydrateClient` with
  resolved data when the hover prefetch already populated the client cache
  (soft nav).

Match home's successful `await prefetch` + `HydrateClient` pattern when in doubt.

**Verify**: soft-nav from a hovered poster does not show a network
`getItemDetails` when cache is warm (manual DevTools check acceptable).

### Step 4: Lint + tests

**Verify**: `bun run lint && bun run typecheck` → exit 0; run WT / live-tv unit
tests if present.

## Test plan

- Extend plex router / guest WT tests only if DTO shapes change.
- Live TV: unit-test DTO mapping if you introduce a lean mapper.

## Done criteria

- [ ] WT home row does not waterfall N `getItemDetails` after rooms
- [ ] Live TV page can show shell/skeleton while grids load (or payload is materially smaller)
- [ ] Item details soft-nav uses warm cache without redundant fetch when prefetched
- [ ] README status DONE

## STOP conditions

- If lean Live TV DTO would break tune/playback work in progress, keep full
  Media fields and only stream the shell.
- Do not store plex auth tokens in the rooms list DTO beyond what cards need
  for images (images should keep using `/api/plex/image`).

## Maintenance

`useWatchTogetherRoomMedia` is shared with the lobby — if cards stop using full
details, keep the hook for lobby/hero where full metadata is required.

# Spike: TanStack DB as Multiplex sync engine

**Branch intent:** prove that a durable, browser-local replica can power
instant navigations and offline reads for Plex shell data, without rewriting
Effect player/session ownership or Multiplex auth.

**Demo route:** `/spike/sync` (authenticated app shell)

**Code:** `apps/web/src/lib/sync-engine/`

## Verdict

**Use TanStack DB Query Collections + browser SQLite persistence as the client
sync/query layer.** Do **not** adopt Electric, Zero, or TinyBase as the primary
engine for Plex media data.

| Option | Fit for Multiplex | Why |
|--------|-------------------|-----|
| **TanStack DB + Query Collections + OPFS SQLite** | **Primary path** | Works with existing tRPC/Plex APIs; progressive sync; live queries; durable local replica; optimistic mutations; no Postgres mirror required |
| ElectricSQL | Poor as primary | Syncs **your** Postgres shapes. Plex owns libraries/CW/metadata — we'd need a full Plex→Postgres mirror first |
| Zero (Rocicorp) | Poor as primary | Same constraint: needs a syncable backend you control |
| TinyBase | Niche only | Fine for tiny preference graphs; weak for large media catalogs, joins, query-driven sync |
| PowerSync / RxDB | Possible later | Same “mirror Plex into SQL” tax unless used only for Multiplex-owned tables |

Electric/Zero remain relevant **only** if Multiplex later owns collaborative
data in Postgres (e.g. custom lobbies, reactions, watch history mirrors). They
do not replace Plex as source of truth for media.

## What the spike implements

1. **OPFS SQLite persistence** via `@tanstack/browser-db-sqlite-persistence`
   + `BrowserCollectionCoordinator` (multi-tab).
2. **Query Collections** wired to vanilla tRPC for:
   - servers
   - server libraries
   - continue watching
   - home hubs
   - media items (on-demand warm cache)
3. **Credential stripping** before persistence (`accessToken` / `authToken`
   never written to OPFS).
4. **Live queries** (`useLiveQuery`) for instant UI reads from local rows.
5. **Optimistic write path** demo: mark Continue Watching complete →
   `setItemWatchedState` mutation.
6. **Boot in authenticated shell** (`SyncEngineAppShell` in `(app)/layout`)
   so shell collections preload while browsing.

## Architecture (target shape)

```
UI (live queries)
    ↓
TanStack DB collections (normalized, credential-free rows)
    ↓ persistence (OPFS SQLite)
    ↓ sync (Query Collections / progressive + on-demand)
tRPC → plex.tv / PMS   (still authoritative)

Effect PlayerService / WatchTogetherSession  → unchanged (live runtime)
Zustand player prefs                        → unchanged (local prefs)
better-auth SQLite                          → unchanged (server auth)
```

### Sync modes recommended next

| Collection | Mode | Notes |
|------------|------|-------|
| servers, libraries, pinned sources | eager | Small, shell-critical (`SyncMode` in 0.6.x is `eager` \| `on-demand`) |
| continue watching, home hubs | eager + refetchInterval | Replace ad-hoc polling UX |
| library grids / search | on-demand | Query-driven subsets |
| item details | on-demand + hover warm | Matches current hover prefetch |
| play queues, Syncplay, WT lobby | **out of sync engine** | Stay Effect / websocket |

Note: TanStack blog posts mention a `progressive` sync mode; the installed
`@tanstack/db@0.6.16` typings only expose `eager` | `on-demand`. Eager + OPFS
persistence already gives instant restarts for shell data.

## Gaps TanStack DB does not solve alone

These need custom code (started or sketched in the spike):

1. **Plex is not a sync protocol** — no push deltas. Background refetch /
   invalidation after mutations remains required unless Multiplex mirrors Plex.
2. **Token-bearing payloads** — must sanitize at the boundary (done in
   `sanitize.ts`).
3. **Offline writes** — Query Collections optimistic updates +
   `@tanstack/offline-transactions` outbox for durable mutation replay when
   offline (package installed; full outbox wiring deferred).
4. **SSR / RSC** — TanStack DB persistence is browser-first (OPFS). RSC
   HydrateClient can still seed TanStack Query; collections hydrate from OPFS
   on the client. True SSR of live queries needs TanStack’s forthcoming SSR
   story — do not block on it.
5. **Artwork / media streams** — bytes are not in the sync engine; offline
   poster UX needs Cache API / service worker separately.
6. **Existing home/library components** still read tRPC hooks — migration is
   incremental (collection-by-collection), not big-bang.

## How to validate the spike

1. Sign in, open `/spike/sync`, wait until Engine = `ready` and rows populate.
2. Hard reload — rows should appear from OPFS before/without waiting on PMS.
3. DevTools → Network → Offline → reload — sanitized rows should still render.
4. Use “Mark first CW complete” online to exercise optimistic mutation path.
5. Unit tests: `bun test apps/web/src/lib/sync-engine`

## Recommended follow-up (execution order)

1. **Adopt collections behind feature flag for Continue Watching + sidebar
   libraries** — highest navigation/offline win, smallest surface.
2. **Wire `@tanstack/offline-transactions`** for watched/pin/playlist mutations.
3. **Replace split caches** (`media-poster-grid` keys, manual `setData`) with
   collection `writeUpsert` / live queries.
4. **Defer Electric/Zero** until Multiplex-owned collaborative tables exist.
5. **Do not put Effect session/player state into TanStack DB.**

## Package versions spiked

- `@tanstack/db@0.6.16`
- `@tanstack/react-db@0.1.94`
- `@tanstack/query-db-collection@1.1.0`
- `@tanstack/browser-db-sqlite-persistence@0.2.8`
- `@journeyapps/wa-sqlite@1.7.2`
- `@tanstack/offline-transactions@1.0.41` (installed, not fully wired)

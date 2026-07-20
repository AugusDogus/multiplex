# Spike: TanStack DB as Multiplex sync engine

**Branch intent:** prove that a durable, browser-local replica can power
instant navigations and offline reads while **Plex remains the only source of
truth**. Multiplex never owns media tables.

**Code:** `apps/web/src/lib/sync-engine/` (boots in the authenticated app shell)

## Verdict

**Use TanStack DB Query Collections + browser OPFS SQLite persistence** as the
client replica/query layer over existing tRPC→Plex fetches.

| Option                                                 | Fit                  | Why                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack DB + Query Collections + OPFS SQLite**      | **Yes**              | Works with Plex-via-tRPC; durable local replica; live queries; optimistic writes; no Multiplex-owned DB required                                                                                                                    |
| Electric / Zero / PowerSync                            | **No**               | Built to sync **your** Postgres (or equivalent). Multiplex will never own those tables — Plex is always SoT                                                                                                                         |
| TinyBase                                               | **No**               | Too small for media catalogs / query-driven library browsing                                                                                                                                                                        |
| **fate** ([fate.technology](https://fate.technology/)) | **Not for this job** | Relay-style view composition + in-memory normalized cache (+ SSE live views). Explicitly **lacks persistent offline storage** today. Live updates assume _your_ server publishes entity changes — Plex does not push into Multiplex |

Electric/Zero are not a “later” option. They are the wrong shape for a
Plex-pass-through client.

## What the spike implements

1. **OPFS SQLite persistence** via `@tanstack/browser-db-sqlite-persistence`
   - `BrowserCollectionCoordinator` (multi-tab).
2. **Query Collections** wired to vanilla tRPC for:
   - servers
   - server libraries
   - continue watching
   - home hubs
   - media items (on-demand warm cache)
3. **Credential stripping** before persistence (`accessToken` / `authToken`
   never written to OPFS).
4. **Live queries** (`useLiveQuery`) for instant UI reads from local rows.
5. **Optimistic write path** for watched-state updates via collection
   mutators → `setItemWatchedState`.
6. **Boot in authenticated shell** (`SyncEngineAppShell` in `(app)/layout`)
   so shell collections preload while browsing.

## Architecture (target shape)

```
UI (live queries / existing components)
    ↓
TanStack DB collections  ← durable Plex replica (credential-free rows)
    ↓ persistence (OPFS SQLite)
    ↓ sync (Query Collections: eager shell, on-demand browse/details)
tRPC → plex.tv / PMS     ← only source of truth

Effect PlayerService / WatchTogetherSession
    → live runtime (playback, Syncplay, lobby state machines)
    → should *read/write Plex-backed facts through the sync engine*
      (e.g. item metadata, room list) instead of a parallel tRPC cache
```

### Sync modes

| Collection                         | Mode                    | Notes                          |
| ---------------------------------- | ----------------------- | ------------------------------ |
| servers, libraries, pinned sources | eager                   | Shell-critical                 |
| continue watching, home hubs       | eager + refetchInterval | Background reconcile with Plex |
| library grids / search             | on-demand               | Query-driven subsets           |
| item details                       | on-demand + hover warm  | Matches current hover prefetch |
| Syncplay / ephemeral lobby FSM     | Effect runtime          | Not a durable Plex row set     |

Note: TanStack blog posts mention `progressive`; installed `@tanstack/db@0.6.16`
typings only expose `eager` | `on-demand`. Eager + OPFS already gives instant
restarts for shell data.

## Effect and the sync engine (corrected)

Earlier wording (“keep Effect out”) was too blunt.

**Split by kind of state, not by team preference:**

| Kind                                                                                            | Owner                                     | Why                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable Plex facts (servers, libraries, CW, hubs, metadata, playlists, rooms _as Plex records_) | **TanStack DB replica**                   | Survives reload/offline; one normalized cache; instant nav                                                                                               |
| Live orchestration (playhead, buffering, Syncplay clock, lobby phase machines, presence)        | **Effect services**                       | Ephemeral, high-frequency, websocket-driven; wrong to treat as OPFS rows of truth                                                                        |
| Integration                                                                                     | **Effect adapters call into collections** | `WatchTogetherApi.getItemMetadata` / room list should prefer sync-engine reads (and warm collections on miss) so Effect does not maintain a second cache |

So: Effect stays the runtime for _session physics_. It should **not** stay on a
parallel tRPC data path for Plex-backed records — those go through the sync
engine.

## fate — looked at, wrong tool for offline sync

[fate](https://fate.technology/) (nkzw) is a modern Relay-inspired React data
client: co-located views, composed single-request-per-screen, normalized
in-memory cache, data masking, Async React, optional tRPC/Drizzle/Prisma, SSE
live views.

Useful ideas (view composition, normalized cache, waterfall elimination).
**Not a sync engine:**

- Upstream roadmap still lists **“Persistent storage for offline support”** as
  unfinished — no OPFS/SQLite offline replica.
- Live views need Multiplex (or similar) to **publish** entity updates over SSE.
  Plex will not do that; Multiplex is a pass-through client.
- ORM-centric server adapters assume you own the schema. We don’t.

If Multiplex ever wants fate-like view composition, that’s a separate DX
conversation on top of (or instead of) tRPC query hooks — it does not replace
the durable local replica this spike is about.

## Gaps TanStack DB does not solve alone

1. **Plex is not a sync protocol** — no push deltas. Background refetch /
   invalidation after mutations remains required. Never “mirror Plex into our
   Postgres”; reconcile against Plex APIs.
2. **Token-bearing payloads** — sanitize at the boundary (`sanitize.ts`).
3. **Offline writes** — optimistic updates + `@tanstack/offline-transactions`
   outbox for durable mutation replay (package installed; outbox not fully wired).
4. **SSR / RSC** — persistence is browser-first (OPFS). Don’t block on TanStack
   SSR; hydrate from OPFS on the client.
5. **Artwork / media streams** — separate Cache API / service worker work.
6. **Migration** — cut components over to collections directly (no feature-flag
   provider; app is self-hostable).
7. **Offline route navigation** — OPFS holds replica data, but Next App Router
   still needs RSC flights for uncached navigations. Full offline browsing
   needs a service worker / navigation cache (not done).

## How to validate

1. Sign in → home: Continue Watching + hubs + sidebar populate from the replica.
2. Hard reload — shell rows return from OPFS without waiting on a cold PMS path.
3. Soft-nav details → home should not Suspense-wait on Plex prefeches.
4. Unit tests: `bun test apps/web/src/lib/sync-engine`

## Adoption progress

Done on this branch:

1. **Continue Watching** reads `useSyncedContinueWatching` (OPFS replica +
   session connection overlay for play credentials).
2. **Sidebar / server libraries** read `useSyncedServerLibraries` (keeps
   `mediaProviders` for source extraction).
3. **Home hubs** read `useSyncedHomeHubs`.
4. **Home RSC no longer awaits Plex prefeches** for those surfaces — soft-nav
   back from details paints from OPFS instead of Suspense-waiting on PMS.
5. **Timeline + restart** patch the sync-engine CW collection (no more
   `getAllContinueWatching.setData`).
6. **Effect `WatchTogetherApi.getItemMetadata`** warms `mediaItems` after fetch.

Why details→home still felt laggy before this: the home page RSC kept
`await api.plex.*.prefetch()` inside Suspense boundaries even after CW moved
to the sync engine, so soft-nav waited on Plex before mounting local rows.

Still open:

1. **Wire `@tanstack/offline-transactions`** for watched/pin/playlist mutations.
2. **Replace remaining split caches** (poster grids, details, library grids)
   with collections.
3. **Service worker / navigation cache** if true offline route browsing is a
   product goal.
4. **Do not introduce Electric/Zero / fate for offline.**

## Package versions spiked

- `@tanstack/db@0.6.16`
- `@tanstack/react-db@0.1.94`
- `@tanstack/query-db-collection@1.1.0`
- `@tanstack/browser-db-sqlite-persistence@0.2.8`
- `@journeyapps/wa-sqlite@1.7.2`
- `@tanstack/offline-transactions@1.0.41` (installed, not fully wired)

# Implementation Plans

App-wide performance work on `cursor/browse-speed-spike-046b` (2026-07-19).

## Execution order & status

| Plan | Title                                                   | Priority | Effort | Depends on | Status                                     |
| ---- | ------------------------------------------------------- | -------- | ------ | ---------- | ------------------------------------------ |
| 002  | Spike: make browse as fast as Plex web on current stack | P1       | M      | —          | DONE                                       |
| 006  | Stop AppPlexContentGate from blocking page loading UI   | P1       | S–M    | —          | DONE (nested Suspense in content gate)     |
| 007  | Stream library page / overlap pivots + hubs             | P1       | M      | 006        | DONE (hubs stream; pivots cached; runtime prefetch) |
| 008  | Speed Plex image proxy + stop dual-hero downloads       | P1       | M      | —          | DONE (race image URIs; one hero priority)  |
| 009  | Lazy-load MediaPlayerModal off root layout              | P1       | S–M    | —          | DONE                                       |
| 010  | Cut Watch Together + Live TV waterfalls                 | P2       | M      | —          | PARTIAL (WT home prefetch done; Live TV TBD) |
| 003  | Polish `/login` to match in-app Multiplex brand         | P2       | S–M    | —          | TODO (not in this PR)                      |
| 004  | Spike: View Transitions on poster → item details        | P2       | M      | —          | TODO (not in this PR; draft PR #36 exists) |
| 005  | Ship-or-hide Live TV guide until tune exists            | P1       | S      | —          | TODO (not in this PR)                      |

Pre-existing:

| Doc                            | Status                                            |
| ------------------------------ | ------------------------------------------------- |
| `plans/effect-v4-migration.md` | Phases 0–4 + PlayerService done; Phase 5 deferred |

## App-wide wins in this PR (not CW-only)

- PMS connection race + shared warm discovery (`plex-query`)
- Home Suspense lanes + short `"use cache"` for CW/hubs/libraries
- Nested content-gate Suspense so route loading can stream
- Sidebar chrome without awaiting full library provider fan-out
- Library Recommended hubs overlapped with pivot discovery (chrome not blocked on hubs)
- Library pivots/hubs `"use cache"` (minutes) + sidebar hover prefetch
- Next soft-nav (measure with `next start`, not `bun dev`): `staleTimes.dynamic`, `cachedNavigations: 'allow-runtime'`, `appShells`, `dynamicOnHover`, `prefetch = 'allow-runtime'`, `<Link prefetch>`
- Image proxy connection race (every poster/backdrop)
- Details: no HydrateClient pending overwrite; paint from hover TanStack cache
- Lazy `MediaPlayerModal` off initial browse JS
- Home WT row: batch-prefetch room `getItemDetails` to kill N+1

### Fair soft-nav bakeoff (production, 2026-07-19)

Metric: hover 1.2s → click → ≥3 real posters (≥140×200) / details Play|Resume + large image. Plex from signed-in Your Media → Movies (must leave Home).

| Surface | Multiplex | Plex web | Winner |
| ------- | --------: | -------: | ------ |
| Library | 73ms | 122ms | Multiplex |
| Details | 95ms | 227ms | Multiplex |

## Parked

- Zero / Electric / TanStack DB sync engine
- Client-side WASM/ffmpeg as default playback
- Expo / TV / Roku / desktop native

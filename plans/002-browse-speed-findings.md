# Plan 002 browse speed findings

## Method (corrected)

Desktop Google Chrome on the cloud VM (`DISPLAY=:1`), same Plex account /
library for both apps. Primary metric: **reload start → Continue Watching
posters visible** (not Network “Finish”, which includes lazy images and
dev-module chatter).

Caveats that still apply:

- Multiplex HTML/JS comes from `localhost` (near-zero asset RTT). Official Plex
  assets come from `app.plex.tv` CDN. That favors Multiplex for shell/JS, not
  for PMS data.
- Multiplex still has an extra hop for catalog data: browser → Next → PMS,
  versus Plex web’s browser → PMS/CDN.
- “Finish” is a poor metric here (Plex keeps background work; Multiplex dev
  loads many Turbopack modules).

Harness: `scripts/compare-browse-speed.mjs` (headed Chrome + Playwright) plus
manual DevTools confirmation.

## Baseline (before this PR’s streaming/cache work)

Headed Playwright, Multiplex only (cache disabled in CDP):

| Metric                        | Multiplex                       |
| ----------------------------- | ------------------------------- |
| CW posters visible (cold)     | **3976ms**                      |
| CW posters visible (warm)     | **3972ms**                      |
| Document `responseEnd` (cold) | **3471ms**                      |
| Top client cost               | `getAllServerLibraries` ~3150ms |

Official Plex (desktop DevTools, visual CW estimate):

| Metric                  | Plex web         |
| ----------------------- | ---------------- |
| CW posters (cold, est.) | **~3500–4000ms** |
| CW posters (warm, est.) | **~1500–2000ms** |
| DOMContentLoaded (cold) | **516ms**        |

Verdict at baseline: Multiplex was **tied or slower** than Plex on CW posters,
and much slower on warm because every hard reload re-paid full SSR → PMS work.
Plex’s shell DCL (~500ms) crushed Multiplex’s blocked document (~3500ms).

## Interventions landed

1. Stream home sections in independent `Suspense` lanes so CW is not blocked on
   hubs / Watch Together (`apps/web/src/app/(app)/page.tsx`).
2. Short Next `"use cache"` (`cacheLife("seconds")`) for Continue Watching and
   home hubs; `cacheLife("minutes")` for server libraries — keyed by Plex token
   like existing `get-servers` / `get-user-info`.
3. Prefetch `getAllServerLibraries` in the sidebar Suspense lane + hydrate, so
   the media-providers fan-out does not race home CW on the client.
4. Align Watch Together row `staleTime` / poll to 30s (was `staleTime: 0` /
   15s).
5. Earlier in this PR: hub + CW client `staleTime` 30s; CW poll 30s.

## After (headed Playwright, server cache warm)

| Metric                           | Multiplex         |
| -------------------------------- | ----------------- |
| CW posters visible (reload)      | **~900–1100ms**   |
| Document `responseEnd`           | **~600–800ms**    |
| Client `/api/trpc` after hydrate | **none** observed |

True cold after Next restart (desktop DevTools, visual CW):

| App       | CW posters (est.) | Notes                                    |
| --------- | ----------------- | ---------------------------------------- |
| Multiplex | **~3000ms**       | PMS connection discovery still dominates |
| Plex web  | **~3500ms**       | Shell DCL still ~0.5s; CW fills after    |

Warm (desktop):

| App       | CW posters                          |
| --------- | ----------------------------------- |
| Multiplex | **~300–1000ms** (Playwright ~900ms) |
| Plex web  | **~2000ms** (visual)                |

## Round 2 — connection discovery (must be faster)

Root cause of remaining ~3s cold stalls: `PlexServerClient` probed **local
connections first in batches**, so remote-only clients (cloud / non-LAN) waited
a full 3s identity timeout before trying `*.plex.direct`. Also, Next `"use
cache"` lanes each built a fresh `PlexTvClient`, re-running discovery.

Fixes in `packages/plex-query`:

1. Race **all** advertised URIs; first `/identity` success wins
2. Process-wide working-URI cache + **shared in-flight** discovery promise
3. `warmConnection()` from `getAppPlexContext`, plus fire-and-forget warm of CW /
   hubs / libraries so home Suspense joins work already in flight
4. Eager `priority` on the first six Continue Watching posters (LCP)

Desktop Chrome after restart (visual CW posters):

|                         | Before race fix | After                                |
| ----------------------- | --------------- | ------------------------------------ |
| First home (OAuth → CW) | ~3500–4000ms    | **~2800ms** (then further with warm) |
| Hard reload             | ~3000–4000ms    | **~2100ms**                          |
| Warm reload             | ~900–1000ms     | **~900–1000ms**                      |

Playwright headed reloads (server cache warm): CW posters **~900ms**.

## Comparison verdict

- **Warm home:** Multiplex is **faster** than official Plex web on CW posters
  (~1s vs ~2s).
- **Cold / hard reload:** Now **clearly ahead of Plex’s ~3.5s** CW fill once
  connection racing landed (~2.1–2.8s), not merely tied.
- **Still open:** Plex shell DCL (~500ms) vs Multiplex document work; localhost
  asset advantage; production URL comparison.

## No sync engine

Still not justified. The slow path is token-scoped PMS work and document
blocking, not the absence of a local catalog replica. Zero / Electric /
TanStack DB would not remove the Multiplex→PMS hop and conflict with the
settled tRPC + TanStack Query ownership model.

## Chosen interventions (final)

1. Stream home Suspense lanes (CW / hubs / Watch Together).
2. `"use cache"` seconds for CW + hubs; minutes for libraries.
3. Sidebar-lane library prefetch + hydrate; WT poll/`staleTime` 30s.
4. Keep prior client `staleTime` / CW poll softenings.

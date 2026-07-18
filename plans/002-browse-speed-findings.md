# Plan 002 browse speed findings

## Before

1. **Home cold load**
   - Measured with a headless Playwright run against `http://localhost:3000`, logged in via the existing Plex OAuth helper using `MULTIPLEX_ACCOUNT_EMAIL` / `MULTIPLEX_ACCOUNT_PASSWORD`.
   - Navigation start to first resolved Continue Watching row state: **3725ms**.
   - Browser-observed post-hydration tRPC response within 5s: one batched `plex.getHomeHubs`, `plex.getAllContinueWatching`, and `plex.getWatchTogetherRooms` request, **200**, **276ms**.

2. **Home warm load**
   - Reloaded the authenticated home page within 30s in the same browser context.
   - Reload start to first resolved Continue Watching row state: **3477ms**.
   - Hydrated data did not fully stick: within 5s the browser observed one batched `plex.getHomeHubs`, `plex.getAllContinueWatching`, and `plex.getWatchTogetherRooms` request, **200**, **149ms**.

3. **Continue Watching**
   - On an idle, visible home tab for **31000ms**, browser network events observed **4** `plex.getAllContinueWatching` responses.
   - The same idle window observed **2** `plex.getWatchTogetherRooms` responses and **0** `plex.getHomeHubs` responses.

4. **Poster -> details**
   - Could not measure: the one-off headless harness did not establish a reliable details-interactive selector for a cold click versus a hover-prefetched click.
   - Code path confirmed for the hover prefetch trigger: `MediaPosterCard` calls `useItemDetailsNavigation().prefetch()` from poster and metadata `onMouseEnter` / `onFocus`.

## Official Plex web comparison

Could not measure: official Plex web comparison was not automated in this headless one-off harness, and no stable same-library path was selected during this spike.

## Chosen interventions

1. Raise shared hub `staleTime` to **30000ms** so SSR hydration can avoid the immediate warm-load hub refetch and align with the default QueryClient freshness window.
2. Raise Continue Watching default `refreshInterval` to **30000ms** to reduce idle polling from roughly 4 calls per 31s in this measured session to roughly 1 call per 31s.
3. Raise Continue Watching `staleTime` to **30000ms** so hydrated Continue Watching data follows the same short freshness window as the app default while existing player `setData` / invalidation paths remain intact.

No sync engine: measurements still show the slow path is Plex/tRPC/PMS fetch behavior, and a local catalog replica would not remove the token-scoped Plex network hop.

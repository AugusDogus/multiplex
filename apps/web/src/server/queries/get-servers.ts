import { cacheLife } from "next/cache";
import { cache } from "react";
import { PlexTvClient, type PlexDevice } from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { CachedPlexResult } from "~/server/queries/cached-plex-result";

/**
 * The server list changes rarely (a server coming online/offline), so cache it
 * per user (the token is the cache key) with stale-while-revalidate semantics.
 * This keeps the 5s Continue Watching poll from hitting plex.tv on every tick.
 *
 * The token must be passed as an argument: "use cache" arguments form the
 * cache key and must be serializable, so we reconstruct the client inside.
 * NOTE: the raw token is part of the cache key. Fine for the default
 * in-memory handler; revisit before configuring a durable `cacheHandlers`
 * backend (Redis/disk), which would persist it.
 */
async function fetchServers(
  token: string,
): Promise<CachedPlexResult<PlexDevice[]>> {
  "use cache";
  cacheLife("minutes");

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return CachedPlexResult.capture(() => plex.getServers());
}

/**
 * React `cache` additionally dedupes calls within a single RSC render.
 * Re-raises an expired token as a `PlexAPIError` on this side of the
 * `"use cache"` boundary so callers can classify it.
 */
export const getServersQuery = cache(async (plex: PlexTvClient) => {
  return CachedPlexResult.unwrap(await fetchServers(plex.getToken()));
});

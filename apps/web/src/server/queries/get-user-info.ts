import { createHash } from "node:crypto";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { cache } from "react";
import { PlexTvClient, type PlexUserInfo } from "@multiplex/plex-query";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { CachedPlexResult } from "~/server/queries/cached-plex-result";

/**
 * User info (including pinned sources) changes rarely and only through our own
 * mutations, so cache it per user with stale-while-revalidate semantics.
 * Mutations that change it must call `invalidateUserInfoCache`.
 * NOTE: the raw token is part of the cache key (only the tag is digested).
 * Fine for the default in-memory handler; revisit before configuring a
 * durable `cacheHandlers` backend (Redis/disk), which would persist it.
 */

/** Tag entries with a token digest rather than the raw auth token. */
function userInfoTag(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `user-info-${digest}`;
}

async function fetchUserInfo(
  token: string,
): Promise<CachedPlexResult<PlexUserInfo>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(userInfoTag(token));

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  return CachedPlexResult.capture(() => plex.getUserInfo());
}

/**
 * React `cache` additionally dedupes calls within a single RSC render.
 * Re-raises an expired token as a `PlexAPIError` on this side of the
 * `"use cache"` boundary so callers can classify it. Callers that need
 * guaranteed-fresh data should use `plex.getUserInfo()` directly.
 */
export const getUserInfoQuery = cache(async (plex: PlexTvClient) => {
  return CachedPlexResult.unwrap(await fetchUserInfo(plex.getToken()));
});

/**
 * Mark the cached user info stale after a mutation. SWR semantics: the next
 * read may still serve the old entry once while revalidating in the
 * background, so mutations must NOT read their own writes through
 * `getUserInfoQuery` — use `plex.getUserInfo()` directly.
 */
export function invalidateUserInfoCache(plex: PlexTvClient): void {
  revalidateTag(userInfoTag(plex.getToken()), "max");
}

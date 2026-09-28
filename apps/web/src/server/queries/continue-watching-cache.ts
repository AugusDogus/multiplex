import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import type { PlexTvClient } from "@multiplex/plex-query";

/** Shared by home Continue Watching and library Recommended hub caches. */
export function continueWatchingTag(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `continue-watching-${digest}`;
}

export function invalidateContinueWatchingCache(plex: PlexTvClient): void {
  // tRPC runs in a Route Handler, so use immediate expiration rather than updateTag.
  revalidateTag(continueWatchingTag(plex.getToken()), { expire: 0 });
}

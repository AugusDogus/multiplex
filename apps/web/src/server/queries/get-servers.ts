import { cache } from "react";
import type { PlexTvClient } from "@multiplex/plex-query";

/**
 * Wrapped in React `cache` so repeated calls within a single RSC render
 * (page-level fetches + per-procedure server context resolution) only hit
 * plex.tv once per request. Outside of RSC rendering `cache` is a no-op.
 */
export const getServersQuery = cache(async (plex: PlexTvClient) => {
  return plex.getServers();
});

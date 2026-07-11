import type { ContinueWatchingItem } from "./plex/schemas/continue-watching-schemas";

/**
 * Continue Watching item enriched with the server it was fetched from.
 * Used by browse surfaces and media playback clients.
 */
export type ContinueWatchingItemWithServer = ContinueWatchingItem & {
  serverUrl?: string;
  authToken?: string;
  serverId: string;
  serverName?: string;
};

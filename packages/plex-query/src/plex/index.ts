// Export schemas, types, and utilities
export * from "./schemas";
export * from "./types";
export * from "./utils";

// Export legacy imports for backward compatibility
export { PlexServerClient } from "./clients/plex-server-client";
export { SyncplayClient } from "./clients/syncplay-client";
export type {
  SyncplayParticipantState,
  SyncplayPlaybackState,
  SyncplayUser,
} from "./clients/syncplay-client";
export { PlexTvAuthService } from "./clients/plex-tv-auth-service";
export { PlexTvClient } from "./clients/plex-tv-client";
export { WatchTogetherClient } from "./clients/watch-together-client";

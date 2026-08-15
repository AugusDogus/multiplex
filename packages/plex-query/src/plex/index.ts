// Export schemas, types, and utilities
export * from "./schemas";
export * from "./types";
export * from "./utils";

// Export legacy imports for backward compatibility
export { clearPlexServerConnectionCache, PlexServerClient } from "./clients/plex-server-client";
export { PlaybackIntent } from "./clients/playback-intent";
export type { PlaybackIntent as PlaybackIntentShape } from "./clients/playback-intent";
export { decodeSyncplayUser, encodeSyncplayUser, SyncplayClient } from "./clients/syncplay-client";
export type {
  SyncplayClientOptions,
  SyncplayParticipantState,
  SyncplayPlaybackState,
  SyncplayRemoteAction,
  SyncplayRemoteActionType,
  SyncplayStateInput,
  SyncplayUser,
  SyncplayWebSocketFactory,
  SyncplayWebSocketLike,
} from "./clients/syncplay-client";
export { SyncplaySessionController } from "./clients/syncplay-session-controller";
export type {
  SyncplayPlayerAdapter,
  SyncplayPlayerState,
  SyncplaySeekResult,
  SyncplaySessionControllerOptions,
} from "./clients/syncplay-session-controller";
export { PlexTvAuthService } from "./clients/plex-tv-auth-service";
export { PlexTvClient } from "./clients/plex-tv-client";
export { WatchTogetherClient } from "./clients/watch-together-client";

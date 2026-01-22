// Main API export
export { api } from "./api";
export type { ContinueWatchingItemWithServer, AllContinueWatchingParams } from "./api";

// Query keys for advanced usage
export { plexKeys } from "./keys";
export type { PlexQueryKey } from "./keys";

// Config
export { DEFAULT_PLEX_CONFIG, getPlexConfig } from "./config";

// Query factory utilities (for extending)
export { createQuery, createMutation, createDependentQuery } from "./create-query";

// Re-export Plex types and utilities for convenience
export * from "./plex";

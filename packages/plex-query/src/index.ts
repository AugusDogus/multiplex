// Main API export
export { api } from "./api";
export type { ContinueWatchingItemWithServer, AllContinueWatchingParams } from "./api";

// Query keys for advanced usage
export { plexKeys } from "./keys";
export type { PlexQueryKey } from "./keys";

// Config
export { DEFAULT_PLEX_CONFIG, getPlexConfig } from "./config";

// Pagination defaults
export { HUB_PAGE_SIZE, HUB_PREVIEW_SIZE, LIBRARY_PAGE_SIZE } from "./constants/pagination";

// Query factory utilities (for extending)
export { createQuery, createMutation, createDependentQuery } from "./create-query";

// Re-export Plex types and utilities for convenience
export * from "./plex";

// Watch Together domain (session state + rotation policy)
export * from "./watch-together";

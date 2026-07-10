// Continue Watching types used by the web app / Effect boundary
export type { ContinueWatchingItemWithServer } from "./api";

// Config
export { DEFAULT_PLEX_CONFIG, getPlexConfig } from "./config";

// Pagination defaults
export { HUB_PAGE_SIZE, HUB_PREVIEW_SIZE, LIBRARY_PAGE_SIZE } from "./constants/pagination";

// Re-export Plex types and utilities for convenience
export * from "./plex";

// Watch Together domain (session state + rotation policy)
export * from "./watch-together";

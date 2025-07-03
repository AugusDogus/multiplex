import type { ContinueWatchingItem } from "../schemas/continue-watching-schemas";
import { getUniversalThumbnailUrl } from "./image-utils";

/* ────────────────────────────────────────────────────────────
   Continue Watching Item Utilities
   Helper functions for working with Continue Watching items
   ──────────────────────────────────────────────────────────── */

/**
 * Get a formatted time remaining string
 */
export function formatTimeRemaining(timeRemainingMs?: number): string {
  if (!timeRemainingMs || timeRemainingMs <= 0) return "";

  const minutes = Math.ceil(timeRemainingMs / 1000 / 60);
  if (minutes < 60) {
    return `${minutes}m left`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h left`;
  }

  return `${hours}h ${remainingMinutes}m left`;
}

/**
 * Get a formatted progress string
 */
export function formatProgress(progressPercent?: number): string {
  if (!progressPercent) return "0%";
  return `${Math.round(progressPercent)}%`;
}

/**
 * Check if an item should be considered "completed"
 */
export function isCompleted(item: ContinueWatchingItem): boolean {
  return item.isCompleted ?? false;
}

/**
 * Get the main title for an item (show title for episodes, movie title for movies)
 */
export function getMainTitle(item: ContinueWatchingItem): string {
  if (item.type === "episode" && item.grandparentTitle) {
    return item.grandparentTitle; // Show title
  }
  return item.title; // Movie title or fallback
}

/**
 * Get the subtitle for an item (episode info for shows, year for movies)
 */
export function getSubtitle(item: ContinueWatchingItem): string {
  if (item.type === "episode") {
    const seasonEpisode =
      item.parentIndex && item.index
        ? `S${item.parentIndex} · E${item.index}`
        : "";

    if (seasonEpisode && item.title) {
      return `${item.title}\n${seasonEpisode}`;
    } else if (seasonEpisode) {
      return seasonEpisode;
    } else if (item.title) {
      return item.title;
    }
  } else if (item.type === "movie" && item.year) {
    return item.year.toString();
  }

  return "";
}

/**
 * Get the best thumbnail URL for an item using Plex photo transcoding
 * Returns a 2:3 aspect ratio (200x300) thumbnail URL
 * @deprecated Use getUniversalThumbnailUrl from image-utils instead
 */
export function getThumbnailUrl(
  item: ContinueWatchingItem,
  serverUrl?: string,
  authToken?: string,
): string | undefined {
  return getUniversalThumbnailUrl(item, serverUrl, authToken);
}

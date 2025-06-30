import type { ContinueWatchingItem } from "../schemas/continue-watching-schemas";

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
 * Returns a 2:3 aspect ratio (240x360) thumbnail URL
 */
export function getThumbnailUrl(
  item: ContinueWatchingItem,
  serverUrl?: string,
  authToken?: string,
): string | undefined {
  if (!serverUrl || !authToken) {
    return undefined;
  }

  // Get the best thumbnail path for the item type
  let thumbnailPath: string | undefined;

  if (item.type === "episode") {
    // For episodes in Continue Watching, prefer show poster (grandparentThumb) for consistency
    thumbnailPath = item.grandparentThumb ?? item.thumb;
  } else {
    // For movies and other content, use the main thumbnail
    thumbnailPath = item.thumb;
  }

  if (!thumbnailPath) {
    return undefined;
  }

  // Build the transcoded thumbnail URL with 2:3 aspect ratio (200x300)
  let baseUrl = serverUrl.replace(/\/$/, ""); // Remove trailing slash

  // If the current page is HTTPS but server URL is HTTP, upgrade to HTTPS to avoid mixed content issues
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    baseUrl.startsWith("http:")
  ) {
    baseUrl = baseUrl.replace("http:", "https:");
  }

  const encodedThumbUrl = encodeURIComponent(
    `${thumbnailPath}?X-Plex-Token=${authToken}`,
  );

  return `${baseUrl}/photo/:/transcode?width=200&height=300&minSize=1&upscale=1&url=${encodedThumbUrl}&X-Plex-Token=${authToken}`;
}

import type { ContinueWatchingItem } from "../schemas/continue-watching-schemas";

interface PlexImageOptions {
  width: number;
  height: number;
  minSize?: boolean;
  upscale?: boolean;
}

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

  return getPlexImageUrl(thumbnailPath, serverUrl, authToken, {
    width: 200,
    height: 300,
    minSize: true,
    upscale: true,
  });
}

/**
 * Build a Plex photo transcoder URL for any image path on a server.
 */
export function getPlexImageUrl(
  imagePath: string | undefined,
  serverUrl: string | undefined,
  authToken: string | undefined,
  options: PlexImageOptions,
): string | undefined {
  if (!imagePath || !serverUrl || !authToken) {
    return undefined;
  }

  const baseUrl = serverUrl.replace(/\/$/, "");
  const imageUrl = imagePath.startsWith("http")
    ? imagePath
    : `${imagePath}?X-Plex-Token=${authToken}`;
  const params = new URLSearchParams({
    width: options.width.toString(),
    height: options.height.toString(),
    url: imageUrl,
    "X-Plex-Token": authToken,
  });

  if (options.minSize ?? true) {
    params.set("minSize", "1");
  }

  if (options.upscale ?? true) {
    params.set("upscale", "1");
  }

  return `${baseUrl}/photo/:/transcode?${params.toString()}`;
}

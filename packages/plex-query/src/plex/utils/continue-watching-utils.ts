import type { ContinueWatchingItem, ItemMetadata } from "../schemas/continue-watching-schemas";
import {
  formatMetadataDuration,
  formatRemainingDuration,
  formatSeasonEpisodeLabel,
  getMetadataTypeLabel,
  getPosterImagePath,
  type MetadataPosterInput,
} from "./metadata-utils";

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
  if (!timeRemainingMs) {
    return "";
  }

  return formatRemainingDuration(timeRemainingMs, "compact");
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
export function getMainTitle(item: ItemMetadata): string {
  if (item.type === "season" && item.parentTitle) {
    return item.parentTitle;
  }

  if (item.type === "episode" && item.grandparentTitle) {
    return item.grandparentTitle;
  }

  return item.title;
}

export function getContinueWatchingEpisodeTitle(item: ItemMetadata): string | undefined {
  if (item.type !== "episode") {
    return undefined;
  }

  return item.title;
}

export function formatLastViewedLabel(lastViewedAt: Date | undefined): string | undefined {
  if (!lastViewedAt) {
    return undefined;
  }

  const diffMs = Date.now() - lastViewedAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return "Watched today";
  }

  if (diffDays === 1) {
    return "Watched yesterday";
  }

  if (diffDays < 7) {
    return `Watched ${diffDays} days ago`;
  }

  return `Watched ${lastViewedAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function getContinueWatchingDetailChips(item: ItemMetadata): string[] {
  const chips: string[] = [];

  const typeLabel = getMetadataTypeLabel(item.type);
  if (typeLabel) {
    chips.push(typeLabel);
  }

  if (item.type === "episode") {
    const seasonEpisode = formatSeasonEpisodeLabel(item.parentIndex, item.index);
    if (seasonEpisode) {
      chips.push(seasonEpisode);
    }
  }

  if (item.year) {
    chips.push(item.year.toString());
  }

  if (item.contentRating) {
    chips.push(item.contentRating);
  }

  const duration = formatMetadataDuration(item.duration);
  if (duration) {
    chips.push(duration);
  }

  return chips;
}

/**
 * Get the subtitle for an item (episode info for shows, year for movies)
 */
export function getSubtitle(item: ItemMetadata): string {
  if (item.type === "episode") {
    const seasonEpisode = formatSeasonEpisodeLabel(item.parentIndex, item.index);

    if (item.title && seasonEpisode) {
      return `${item.title}\n${seasonEpisode}`;
    }

    if (seasonEpisode) {
      return seasonEpisode;
    }

    if (item.title) {
      return item.title;
    }
  }

  if (item.type === "movie" && item.year) {
    return item.year.toString();
  }

  return "";
}

/**
 * Get the best thumbnail URL for an item using Plex photo transcoding
 * Returns a 2:3 aspect ratio (200x300) thumbnail URL
 */
export function getThumbnailUrl(
  item: MetadataPosterInput,
  serverUrl?: string,
  authToken?: string,
): string | undefined {
  if (!serverUrl || !authToken) {
    return undefined;
  }

  const thumbnailPath = getPosterImagePath(item);

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

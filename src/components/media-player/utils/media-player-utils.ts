import {
  getMainTitle,
  getSubtitle,
} from "~/lib/plex.tv/continue-watching-utils";
import type { MediaPlayerItem } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Media Player Utilities
   General utility functions for the media player
   ──────────────────────────────────────────────────────────── */

/**
 * Get the main title for a media item
 * @param item - The media player item
 * @returns The main title (show name for episodes, movie title for movies)
 */
export function getMediaTitle(item: MediaPlayerItem): string {
  return getMainTitle(item);
}

/**
 * Get the subtitle for a media item
 * @param item - The media player item
 * @returns The subtitle (episode info for episodes, null for movies)
 */
export function getMediaSubtitle(item: MediaPlayerItem): string | null {
  return getSubtitle(item);
}

/**
 * Get the media duration in seconds
 * @param item - The media player item
 * @returns Duration in seconds, or null if not available
 */
export function getMediaDuration(item: MediaPlayerItem): number | null {
  return item.duration ? Math.floor(item.duration / 1000) : null;
}

/**
 * Get the start time for playback (resume position)
 * @param item - The media player item
 * @returns Start time in seconds
 */
export function getStartTime(item: MediaPlayerItem): number {
  return item.viewOffset ? Math.floor(item.viewOffset / 1000) : 0;
}

/**
 * Determine if controls should be visible based on UI state
 * @param isMouseMoving - Whether the mouse is currently moving
 * @param isPlaying - Whether the video is currently playing
 * @param isTouch - Whether this is a touch device
 * @returns True if controls should be visible
 */
export function shouldShowControls(
  isMouseMoving: boolean,
  isPlaying: boolean,
  isTouch: boolean,
): boolean {
  // Always show controls if not playing
  if (!isPlaying) return true;

  // On touch devices, controls are toggled manually
  if (isTouch) return false;

  // Show controls when mouse is moving
  return isMouseMoving;
}

/**
 * Get a user-friendly error message from a MediaError
 * @param error - The MediaError object from the video element
 * @returns Human-readable error message
 */
export function getVideoElementError(error: MediaError | null): string {
  if (!error) return "Unknown video error";

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Video playback was aborted";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error occurred while loading video";
    case MediaError.MEDIA_ERR_DECODE:
      return "Video format is not supported";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Video source is not supported";
    default:
      return "Unknown video error occurred";
  }
}

/**
 * Check if the device supports fullscreen API
 * @returns True if fullscreen is supported
 */
export function supportsFullscreen(): boolean {
  return Boolean(
    document.fullscreenEnabled ??
      (document as Document & { webkitFullscreenEnabled?: boolean })
        .webkitFullscreenEnabled ??
      (document as Document & { mozFullScreenEnabled?: boolean })
        .mozFullScreenEnabled ??
      (document as Document & { msFullscreenEnabled?: boolean })
        .msFullscreenEnabled,
  );
}

/**
 * Check if the browser supports the Picture-in-Picture API
 * @returns True if PiP is supported
 */
export function supportsPictureInPicture(): boolean {
  return "pictureInPictureEnabled" in document;
}

/**
 * Get the appropriate thumbnail URL for a media item
 * @param item - The media player item
 * @param serverUrl - The Plex server URL
 * @param authToken - The authentication token
 * @returns The thumbnail URL, or null if not available
 */
export function getMediaThumbnail(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
): string | null {
  const thumb = item.thumb ?? item.parentThumb ?? item.grandparentThumb;
  if (!thumb) return null;

  const baseUrl = serverUrl.replace(/\/$/, "");
  const thumbnailUrl = new URL(`${baseUrl}${thumb}`);
  thumbnailUrl.searchParams.set("X-Plex-Token", authToken);

  return thumbnailUrl.toString();
}

/**
 * Calculate the aspect ratio from width and height
 * @param width - Video width
 * @param height - Video height
 * @returns Aspect ratio as a decimal (e.g., 1.78 for 16:9)
 */
export function calculateAspectRatio(width: number, height: number): number {
  return height > 0 ? width / height : 16 / 9; // Default to 16:9
}

/**
 * Check if a media item is an episode
 * @param item - The media player item
 * @returns True if the item is an episode
 */
export function isEpisode(item: MediaPlayerItem): boolean {
  return item.type === "episode";
}

/**
 * Check if a media item is a movie
 * @param item - The media player item
 * @returns True if the item is a movie
 */
export function isMovie(item: MediaPlayerItem): boolean {
  return item.type === "movie";
}

/**
 * Get season and episode information for episodes
 * @param item - The media player item
 * @returns Season/episode info or null if not an episode
 */
export function getEpisodeInfo(
  item: MediaPlayerItem,
): { season: number; episode: number } | null {
  if (!isEpisode(item)) return null;

  const season = item.parentIndex;
  const episode = item.index;

  if (typeof season === "number" && typeof episode === "number") {
    return { season, episode };
  }

  return null;
}

/**
 * Format episode information as a string
 * @param item - The media player item
 * @returns Formatted episode string (e.g., "S01E05") or null
 */
export function formatEpisodeInfo(item: MediaPlayerItem): string | null {
  const episodeInfo = getEpisodeInfo(item);
  if (!episodeInfo) return null;

  const season = episodeInfo.season.toString().padStart(2, "0");
  const episode = episodeInfo.episode.toString().padStart(2, "0");

  return `S${season}E${episode}`;
}

/**
 * Clamp a value between a minimum and maximum
 * @param value - The value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

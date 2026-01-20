import type { MediaPlayerItem } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Plex Stream Utilities
   Functions for generating Plex streaming URLs and handling media data
   ──────────────────────────────────────────────────────────── */

/**
 * Generate a Plex streaming URL for a media item
 * @param item - The media player item to generate URL for
 * @param serverUrl - The Plex server URL
 * @param authToken - The authentication token
 * @returns The streaming URL for the media item
 * @throws Error if no media part key is found
 */
export function generatePlexStreamUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
): string {
  if (!item.Media?.[0]?.Part?.[0]?.key) {
    throw new Error("No media part key found for item");
  }

  const partKey = item.Media[0].Part[0].key;
  const baseUrl = serverUrl.replace(/\/$/, "");

  const streamUrl = new URL(`${baseUrl}${partKey}`);
  streamUrl.searchParams.set("X-Plex-Token", authToken);

  // Add transcoding parameters for web playback
  streamUrl.searchParams.set("X-Plex-Platform", "Chrome");
  streamUrl.searchParams.set("X-Plex-Platform-Version", "1.0");
  streamUrl.searchParams.set("X-Plex-Product", "Multiplex");
  streamUrl.searchParams.set("X-Plex-Version", "1.0");
  streamUrl.searchParams.set("X-Plex-Client-Identifier", "multiplex-web");

  // Add additional parameters that might help with CORS
  streamUrl.searchParams.set("X-Plex-Protocol", "1.0");
  streamUrl.searchParams.set("X-Plex-Device", "Chrome");
  streamUrl.searchParams.set("X-Plex-Device-Name", "Multiplex Web");

  // Add session identifier to help with CORS caching
  streamUrl.searchParams.set(
    "X-Plex-Session-Identifier",
    `multiplex-${Date.now()}`,
  );

  return streamUrl.toString();
}

/**
 * Format time in seconds to human-readable format (MM:SS or HH:MM:SS)
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Calculate progress percentage from current time and duration
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @returns Progress percentage (0-100)
 */
export function calculateProgress(
  currentTime: number,
  duration: number,
): number {
  return duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
}

/**
 * Check if playback is near the end of the media
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @param threshold - Threshold in seconds to consider "near end" (default: 30)
 * @returns True if playback is within threshold seconds of the end
 */
export function isNearEnd(
  currentTime: number,
  duration: number,
  threshold = 30,
): boolean {
  return duration > 0 && duration - currentTime <= threshold;
}

/**
 * Convert milliseconds to seconds (Plex often uses milliseconds)
 * @param milliseconds - Time in milliseconds
 * @returns Time in seconds
 */
export function millisecondsToSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000);
}

/**
 * Convert seconds to milliseconds
 * @param seconds - Time in seconds
 * @returns Time in milliseconds
 */
export function secondsToMilliseconds(seconds: number): number {
  return Math.floor(seconds * 1000);
}

/**
 * Calculate the time remaining in a media item
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @returns Time remaining in seconds, or 0 if invalid
 */
export function calculateTimeRemaining(
  currentTime: number,
  duration: number,
): number {
  if (duration <= 0 || currentTime < 0) return 0;
  return Math.max(0, duration - currentTime);
}

/**
 * Check if a media item has valid streaming data
 * @param item - The media player item to validate
 * @returns True if the item has valid media parts for streaming
 */
export function hasValidStreamingData(item: MediaPlayerItem): boolean {
  return Boolean(
    item.Media?.[0]?.Part?.[0]?.key && item.serverUrl && item.authToken,
  );
}

/**
 * Image utilities for Plex media server
 * Consolidates all image URL generation logic in one place
 */

/**
 * Get the best server URL for image requests, with proper port filtering
 * This handles SSL certificate issues by removing ports from custom domains
 */
export function getImageServerUrl(serverUrl: string): string {
  if (!serverUrl) return serverUrl;
  
  let baseUrl = serverUrl.replace(/\/$/, ""); // Remove trailing slash
  
  // Remove port from custom domains if present (to avoid SSL certificate issues)
  // Keep ports for plex.direct URLs as they have valid certificates
  if (!baseUrl.includes(".plex.direct") && /:\d+$/.test(baseUrl)) {
    baseUrl = baseUrl.replace(/:\d+$/, "");
  }
  
  return baseUrl;
}

/**
 * Generate a Plex photo transcoding URL for thumbnails
 * Uses 2:3 aspect ratio (200x300) for consistent poster display
 */
export function getPlexImageUrl(
  thumbnailPath: string,
  serverUrl: string,
  authToken: string,
  options: {
    width?: number;
    height?: number;
    minSize?: number;
    upscale?: number;
  } = {}
): string {
  const {
    width = 200,
    height = 300,
    minSize = 1,
    upscale = 1,
  } = options;

  const baseUrl = getImageServerUrl(serverUrl);
  
  const encodedThumbUrl = encodeURIComponent(
    `${thumbnailPath}?X-Plex-Token=${authToken}`,
  );

  return `${baseUrl}/photo/:/transcode?width=${width}&height=${height}&minSize=${minSize}&upscale=${upscale}&url=${encodedThumbUrl}&X-Plex-Token=${authToken}`;
}

/**
 * Universal thumbnail URL generator for any Plex media item
 * Works with continue watching items, search results, and any media with thumb property
 */
export function getUniversalThumbnailUrl(
  item: { type?: string; thumb?: string; grandparentThumb?: string },
  serverUrl?: string,
  authToken?: string,
): string | undefined {
  if (!serverUrl || !authToken) {
    return undefined;
  }

  // Get the best thumbnail path for the item type
  let thumbnailPath: string | undefined;

  if (item.type === "episode") {
    // For episodes, prefer show poster (grandparentThumb) for consistency
    thumbnailPath = item.grandparentThumb ?? item.thumb;
  } else {
    // For movies, shows, music, people, and other content, use the main thumbnail
    thumbnailPath = item.thumb;
  }

  if (!thumbnailPath) {
    return undefined;
  }

  return getPlexImageUrl(thumbnailPath, serverUrl, authToken);
}
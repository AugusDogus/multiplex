import type { ProcessedSearchResult } from "../schemas/search-schemas";

/**
 * Get the best thumbnail URL for a search result using Plex photo transcoding
 * Returns a 2:3 aspect ratio (200x300) thumbnail URL
 */
export function getSearchResultThumbnailUrl(
  result: ProcessedSearchResult,
): string | undefined {
  if (!result.serverUrl || !result.authToken) {
    return undefined;
  }

  // Get the best thumbnail path for the result type
  let thumbnailPath: string | undefined;

  if (result.type === 'episode') {
    // For episodes, prefer show poster (grandparentThumb) for consistency
    // Note: we don't have grandparentThumb in search results, so we use thumb
    thumbnailPath = result.thumb;
  } else {
    // For movies, shows, music, people, and other content, use the main thumbnail
    thumbnailPath = result.thumb;
  }

  if (!thumbnailPath) {
    return undefined;
  }

  // Build the transcoded thumbnail URL with 2:3 aspect ratio (200x300)
  let baseUrl = result.serverUrl.replace(/\/$/, ""); // Remove trailing slash

  // If the current page is HTTPS but server URL is HTTP, upgrade to HTTPS to avoid mixed content issues
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    baseUrl.startsWith("http:")
  ) {
    baseUrl = baseUrl.replace("http:", "https:");
  }

  const encodedThumbUrl = encodeURIComponent(
    `${thumbnailPath}?X-Plex-Token=${result.authToken}`,
  );

  return `${baseUrl}/photo/:/transcode?width=200&height=300&minSize=1&upscale=1&url=${encodedThumbUrl}&X-Plex-Token=${result.authToken}`;
}
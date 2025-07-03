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

  // Skip HTTPS upgrade to avoid SSL certificate issues
  // Let the browser handle mixed content warnings instead of forcing invalid certificates

  const encodedThumbUrl = encodeURIComponent(
    `${thumbnailPath}?X-Plex-Token=${result.authToken}`,
  );

  return `${baseUrl}/photo/:/transcode?width=200&height=300&minSize=1&upscale=1&url=${encodedThumbUrl}&X-Plex-Token=${result.authToken}`;
}
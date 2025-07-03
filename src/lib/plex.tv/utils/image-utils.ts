/**
 * Image utilities for Plex media server
 * Consolidates all image URL generation logic in one place
 */

/**
 * Get the best server URL for image requests from available connections
 * Prioritizes URLs that will work for images without SSL certificate issues
 */
export function getBestImageServerUrl(connections: Array<{ uri: string; local?: boolean; relay?: boolean }>): string | undefined {
  // 1. Prefer plex.direct HTTPS (has valid certs, can keep ports)
  const plexDirectConnection = connections.find(
    (conn) => conn.uri.includes(".plex.direct") && conn.uri.startsWith("https:")
  );
  if (plexDirectConnection) {
    return plexDirectConnection.uri.replace(/\/$/, "");
  }

  // 2. Prefer custom domain HTTPS WITHOUT port (works on port 443)
  const customDomainNoPortConnection = connections.find(
    (conn) =>
      conn.uri.startsWith("https:") &&
      !conn.uri.includes(".plex.direct") &&
      !/:\d+$/.test(conn.uri)
  );
  if (customDomainNoPortConnection) {
    return customDomainNoPortConnection.uri.replace(/\/$/, "");
  }

  // 3. Prefer HTTP connections (work with mixed content warnings)
  const httpConnection = connections.find((conn) => conn.uri.startsWith("http:"));
  if (httpConnection) {
    return httpConnection.uri.replace(/\/$/, "");
  }

  // 4. Fall back to any HTTPS connection, but strip port from custom domains
  const httpsConnection = connections.find((conn) => conn.uri.startsWith("https:"));
  if (httpsConnection) {
    let baseUrl = httpsConnection.uri.replace(/\/$/, "");
    // Strip port from custom domains to avoid cert issues
    if (!baseUrl.includes(".plex.direct") && /:\d+$/.test(baseUrl)) {
      baseUrl = baseUrl.replace(/:\d+$/, "");
    }
    return baseUrl;
  }

  // 5. Last resort - use first available connection
  if (connections.length > 0) {
    return connections[0]!.uri.replace(/\/$/, "");
  }

  return undefined;
}

/**
 * Get the best server URL for image requests, with proper port filtering
 * This handles SSL certificate issues by removing ports from custom domains
 * @deprecated Use getBestImageServerUrl with connections array instead
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
import type { Directory, MediaContainer } from "../schemas/plex-server-schemas";
import {
  isHomeDirectory,
  isLibrarySection,
  isLiveTVDirectory,
  isPlaylistDirectory,
} from "../schemas/plex-server-schemas";
import type { PlexDevice } from "../schemas/plex-tv-schemas";

// Better typed extracted source
export interface ExtractedSource {
  id: string;
  title: string;
  type?: string;
  provider: string;
  providerIdentifier: string;
  isLibrarySection: boolean;
}

/**
 * Get the best server URL from a Plex device connection list.
 */
export function getServerUrl(server: PlexDevice): string | undefined {
  const connections = Array.isArray(server.connections) ? server.connections : [];
  const PORT_REGEX = /:\d+(?=\/|$)/;

  const pick = (pred: (connection: (typeof connections)[0]) => boolean) => connections.find(pred);

  const directNonLocal = pick(
    (connection) =>
      connection?.uri?.startsWith("https://") &&
      connection.uri.includes(".plex.direct") &&
      !connection.local,
  );
  const directLocal = pick(
    (connection) =>
      connection?.uri?.startsWith("https://") &&
      connection.uri.includes(".plex.direct") &&
      connection.local,
  );
  const customNonPlexDirect = pick((connection) => {
    const uri = connection?.uri;
    return uri?.startsWith("https://") && !uri.includes(".plex.direct") && !PORT_REGEX.test(uri);
  });
  const httpsAny = pick((connection) => connection?.uri?.startsWith("https://"));
  const anyConnection = pick((connection) => Boolean(connection?.uri));

  const selected =
    directNonLocal?.uri ??
    directLocal?.uri ??
    customNonPlexDirect?.uri ??
    httpsAny?.uri ??
    anyConnection?.uri;

  if (!selected) {
    return undefined;
  }

  return !selected.includes(".plex.direct") && PORT_REGEX.test(selected)
    ? selected.replace(PORT_REGEX, "")
    : selected;
}

/**
 * Extract all sources from MediaContainer response
 * Maps over all MediaProviders and their Directory arrays to find sources
 */
export function extractAllSources(mediaContainer: MediaContainer): ExtractedSource[] {
  const sources: ExtractedSource[] = [];

  // Map over all MediaProviders
  for (const provider of mediaContainer.MediaContainer.MediaProvider) {
    console.log(`Processing provider: ${provider.title}`);

    // Find the content feature (the one with Directory array)
    const contentFeature = provider.Feature.find(
      (feature) => feature.type === "content" && feature.Directory,
    );

    if (!contentFeature?.Directory) {
      console.log(`No content directory found for provider: ${provider.title}`);
      continue;
    }

    // Map over all directories in this provider
    for (const directory of contentFeature.Directory) {
      const source = extractSourceFromDirectory(directory, provider.title, provider.identifier);
      if (source) {
        sources.push(source);
      }
    }
  }

  console.log("All extracted sources:", sources);
  return sources;
}

/**
 * Extract a source from a Directory object using type guards
 */
function extractSourceFromDirectory(
  directory: Directory,
  providerName: string,
  providerIdentifier?: string,
): ExtractedSource | null {
  // Skip Home directory
  if (isHomeDirectory(directory)) {
    return null;
  }

  // Handle library sections (Movies, TV Shows, etc.)
  if (isLibrarySection(directory)) {
    let sourceId = directory.id;

    // For hubKey-based sections, extract numeric ID
    if (directory.hubKey.includes("/hubs/sections/")) {
      const match = /\/hubs\/sections\/(\d+)/.exec(directory.hubKey);
      sourceId = match ? match[1]! : directory.id;
    }

    return {
      id: sourceId,
      title: directory.title,
      type: directory.type,
      provider: providerName,
      providerIdentifier: providerIdentifier ?? "",
      isLibrarySection: true,
    };
  }

  // Handle playlists
  if (isPlaylistDirectory(directory)) {
    return {
      id: directory.id,
      title: directory.title,
      type: directory.type,
      provider: providerName,
      providerIdentifier: providerIdentifier ?? "",
      isLibrarySection: false,
    };
  }

  // Handle Live TV & DVR
  if (isLiveTVDirectory(directory)) {
    return {
      id: directory.id,
      title: directory.title,
      type: undefined, // Live TV doesn't have a standard type
      provider: providerName,
      providerIdentifier: providerIdentifier ?? "",
      isLibrarySection: false,
    };
  }

  // Handle other directories with id
  if ("id" in directory && typeof directory.id === "string") {
    return {
      id: directory.id,
      title: directory.title,
      type: "type" in directory && typeof directory.type === "string" ? directory.type : undefined,
      provider: providerName,
      providerIdentifier: providerIdentifier ?? "",
      isLibrarySection: false,
    };
  }

  return null;
}

/**
 * Get source type for icon mapping based on Plex library type
 */
export function getSourceTypeFromPlexType(plexType: string, title?: string): string {
  switch (plexType) {
    case "movie":
      return "movies";
    case "show":
      return "tv";
    case "artist":
      return "music";
    case "playlist":
      return "playlist";
    default:
      // Handle special cases by title when type is unknown
      if (title === "Live TV & DVR") {
        return "Live TV & DVR";
      }
      return plexType;
  }
}

/**
 * Create a source object compatible with the existing sidebar structure
 */
export function createSourceFromExtractedSource(
  extractedSource: ExtractedSource,
  serverId: string,
  serverName: string,
) {
  // Generate the correct URL based on provider type
  let href: string;

  if (extractedSource.provider === "Live TV & DVR") {
    // Live TV uses a different URL pattern
    href = `/live-tv/${serverId}/${extractedSource.providerIdentifier}`;
  } else {
    // Library sections use the media URL pattern
    href = `/media/${serverId}/${extractedSource.providerIdentifier}?source=${extractedSource.id}`;
  }

  return {
    key: `server-${serverId}-section-${extractedSource.id}`,
    sourceType: getSourceTypeFromPlexType(extractedSource.type ?? "unknown", extractedSource.title),
    machineIdentifier: serverId,
    directoryID: extractedSource.id,
    title: extractedSource.title,
    serverFriendlyName: serverName,
    isLibrarySection: extractedSource.isLibrarySection,
    href: href,
  };
}

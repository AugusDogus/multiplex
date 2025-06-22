import type { Directory, MediaContainer } from "./schemas";

/**
 * Extract all sources from MediaContainer response
 * Maps over all MediaProviders and their Directory arrays to find sources
 */
export function extractAllSources(mediaContainer: MediaContainer) {
  const sources: Array<{
    id: string;
    title: string;
    type?: string;
    provider: string;
    providerIdentifier: string;
    isLibrarySection: boolean;
  }> = [];

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
      const source = extractSourceFromDirectory(
        directory,
        provider.title,
        provider.identifier,
      );
      if (source) {
        sources.push(source);
      }
    }
  }

  console.log("All extracted sources:", sources);
  return sources;
}

/**
 * Extract a source from a Directory object
 */
function extractSourceFromDirectory(
  directory: Directory,
  providerName: string,
  providerIdentifier?: string,
) {
  // Skip Home directory
  if ("hubKey" in directory && directory.hubKey === "/hubs") {
    return null;
  }

  // Handle library sections (Movies, TV Shows, etc.)
  if (
    "id" in directory &&
    "type" in directory &&
    directory.type !== "playlist"
  ) {
    let sourceId = directory.id;

    // For hubKey-based sections, extract numeric ID
    if (
      "hubKey" in directory &&
      directory.hubKey?.includes("/hubs/sections/")
    ) {
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

  // Handle special sections (Playlists, Live TV & DVR main entry, etc.)
  if ("id" in directory) {
    return {
      id: directory.id,
      title: directory.title,
      type: "type" in directory ? directory.type : undefined,
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
export function getSourceTypeFromPlexType(
  plexType: string,
  title?: string,
): string {
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
  extractedSource: ReturnType<typeof extractAllSources>[0],
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
    sourceType: getSourceTypeFromPlexType(
      extractedSource.type ?? "unknown",
      extractedSource.title,
    ),
    machineIdentifier: serverId,
    directoryID: extractedSource.id,
    title: extractedSource.title,
    serverFriendlyName: serverName,
    isLibrarySection: extractedSource.isLibrarySection,
    href: href,
  };
}

import {
  createSourceFromExtractedSource,
  extractAllSources,
  type MediaContainer,
  type PlexUserInfo,
} from "@multiplex/plex-query";

interface ServerLibraryEntry {
  serverId: string;
  serverOwned: boolean;
  mediaProviders?: MediaContainer;
}

interface ResolveLibraryTitleInput {
  machineIdentifier: string;
  providerIdentifier: string;
  sectionId: string;
  userInfo: PlexUserInfo;
  serverName: string;
  serverLibraries: ServerLibraryEntry[];
  librarySectionTitle?: string;
}

export function resolveLibraryTitle({
  machineIdentifier,
  providerIdentifier,
  sectionId,
  userInfo,
  serverName,
  serverLibraries,
  librarySectionTitle,
}: ResolveLibraryTitleInput): string {
  if (librarySectionTitle) {
    return librarySectionTitle;
  }

  const pinnedSources = userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
  const pinnedSource = pinnedSources.find(
    (source) =>
      source.machineIdentifier === machineIdentifier &&
      source.directoryID === sectionId,
  );

  if (pinnedSource?.title) {
    return pinnedSource.title;
  }

  const serverLibrary = serverLibraries.find(
    (entry) => entry.serverId === machineIdentifier,
  );

  if (!serverLibrary?.mediaProviders) {
    return "Library";
  }

  const matchedSource = extractAllSources(serverLibrary.mediaProviders)
    .map((extracted) =>
      createSourceFromExtractedSource(
        extracted,
        machineIdentifier,
        serverName,
        serverLibrary.serverOwned,
      ),
    )
    .find(
      (source) =>
        source.providerIdentifier === providerIdentifier &&
        source.directoryID === sectionId,
    );

  return matchedSource?.title ?? "Library";
}

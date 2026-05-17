import {
  createSourceFromExtractedSource,
  extractAllSources,
  getPinnedSourceIdentity,
  type PinnedSource,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import type { UseServerLibrariesReturn } from "./use-server-libraries";

export interface SidebarSource extends PinnedSource {
  isLibrarySection: boolean;
  href: string;
}

export interface UseSidebarSourcesReturn {
  pinnedSources: SidebarSource[];
  librarySourcesByServer: Record<string, SidebarSource[]>;
  allLibrarySources: SidebarSource[];
}

export function getSidebarSources(
  userInfo: PlexUserInfo,
  { serverStates }: UseServerLibrariesReturn,
): UseSidebarSourcesReturn {
  const allLibrarySources: SidebarSource[] = [];

  for (const [, state] of serverStates) {
    if (state.data?.mediaProviders && !state.error) {
      try {
        const extractedSources = extractAllSources(state.data.mediaProviders);

        for (const extractedSource of extractedSources) {
          allLibrarySources.push(
            createSourceFromExtractedSource(
              extractedSource,
              state.data.serverId,
              state.data.serverName,
              state.data.serverOwned,
            ),
          );
        }
      } catch (error) {
        console.error(
          `Error processing server ${state.data?.serverName}:`,
          error,
        );
      }
    }
  }

  const userPinnedSources =
    userInfo.settings?.sidebarSettings?.pinnedSources ?? [];
  const pinnedSources = userPinnedSources.map((pinnedSource) => {
    const matchingLibrarySource = allLibrarySources.find(
      (libSource) =>
        getPinnedSourceIdentity(libSource) ===
        getPinnedSourceIdentity(pinnedSource),
    );

    return (
      matchingLibrarySource ?? {
        ...pinnedSource,
        isLibrarySection: false,
        href: `/media/${pinnedSource.machineIdentifier}/${pinnedSource.providerIdentifier}?source=${pinnedSource.directoryID}`,
      }
    );
  });

  const librarySourcesByServer: Record<string, SidebarSource[]> = {};

  for (const source of allLibrarySources) {
    librarySourcesByServer[source.machineIdentifier] ??= [];
    librarySourcesByServer[source.machineIdentifier]!.push(source);
  }

  return {
    pinnedSources,
    librarySourcesByServer,
    allLibrarySources,
  };
}

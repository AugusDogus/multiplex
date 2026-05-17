import { useMemo } from "react";
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

export function useSidebarSources(
  userInfo: PlexUserInfo,
  { serverStates }: UseServerLibrariesReturn,
): UseSidebarSourcesReturn {
  // Extract all library sources from successful server queries
  const allLibrarySources = useMemo(() => {
    const sources: SidebarSource[] = [];

    for (const [, state] of serverStates) {
      if (state.data?.mediaProviders && !state.error) {
        try {
          const extractedSources = extractAllSources(state.data.mediaProviders);

          for (const extractedSource of extractedSources) {
            const source = createSourceFromExtractedSource(
              extractedSource,
              state.data.serverId,
              state.data.serverName,
              state.data.serverOwned,
            );
            sources.push(source);
          }
        } catch (error) {
          console.error(
            `Error processing server ${state.data?.serverName}:`,
            error,
          );
        }
      }
    }

    return sources;
  }, [serverStates]);

  // Match pinned sources with real library sources
  const pinnedSources = useMemo(() => {
    const userPinnedSources =
      userInfo.settings?.sidebarSettings?.pinnedSources ?? [];

    return userPinnedSources.map((pinnedSource) => {
      // Try to find a matching library source (if it has loaded)
      const matchingLibrarySource = allLibrarySources.find(
        (libSource) =>
          getPinnedSourceIdentity(libSource) ===
          getPinnedSourceIdentity(pinnedSource),
      );

      // Use the library source if found, otherwise fall back to pinned source
      return (
        matchingLibrarySource ?? {
          ...pinnedSource,
          isLibrarySection: false,
          href: `/media/${pinnedSource.machineIdentifier}/${pinnedSource.providerIdentifier}?source=${pinnedSource.directoryID}`,
        }
      );
    });
  }, [userInfo.settings?.sidebarSettings?.pinnedSources, allLibrarySources]);

  // Group library sources by server
  const librarySourcesByServer = useMemo(() => {
    const grouped: Record<string, SidebarSource[]> = {};

    for (const source of allLibrarySources) {
      grouped[source.machineIdentifier] ??= [];
      grouped[source.machineIdentifier]!.push(source);
    }

    return grouped;
  }, [allLibrarySources]);

  return {
    pinnedSources,
    librarySourcesByServer,
    allLibrarySources,
  };
}

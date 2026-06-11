import type { PlexUserInfo } from "@multiplex/plex-query";

interface ResolveLibraryTitleInput {
  machineIdentifier: string;
  sectionId: string;
  userInfo: PlexUserInfo;
  librarySectionTitle?: string;
}

export function resolveLibraryTitle({
  machineIdentifier,
  sectionId,
  userInfo,
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

  return pinnedSource?.title ?? "Library";
}

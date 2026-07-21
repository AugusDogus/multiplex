import {
  getNextPinnedSources,
  getPinnedSourceIdentity,
  type PinnedSource,
  type PlexUserInfo,
  toPinnedSource,
} from "@multiplex/plex-query";
import {
  refetchSyncedShellCollections,
  useSyncedUserInfo,
  useSyncEngineCollections,
  writeSyncedUserInfo,
} from "~/lib/sync-engine";
import { api } from "~/trpc/api";

function applyPinnedSourceUpdate(
  userInfo: PlexUserInfo,
  source: PinnedSource,
  action: "pin" | "unpin",
): PlexUserInfo {
  const currentSettings = userInfo.settings ?? { otherSettings: {} };

  return {
    ...userInfo,
    settings: {
      ...currentSettings,
      sidebarSettings: {
        ...currentSettings.sidebarSettings,
        hasCompletedSetup:
          currentSettings.sidebarSettings?.hasCompletedSetup ?? true,
        pinnedSources: getNextPinnedSources(
          currentSettings.sidebarSettings?.pinnedSources ?? [],
          source,
          action,
        ),
      },
    },
  };
}

export function useSidebarPinning(userInfo: PlexUserInfo) {
  const collections = useSyncEngineCollections();
  const userInfoQuery = useSyncedUserInfo({ initialData: userInfo });
  const currentUserInfo = userInfoQuery.data ?? userInfo;

  const togglePinnedSourceMutation = api.plex.togglePinnedSource.useMutation({
    scope: { id: "sidebar-pinning" },
    onMutate: async (variables) => {
      const previousUserInfo = currentUserInfo;
      const next = applyPinnedSourceUpdate(
        previousUserInfo,
        variables.source,
        variables.action,
      );
      if (collections) {
        writeSyncedUserInfo(
          collections,
          next as unknown as Record<string, unknown>,
        );
      }
      return { previousUserInfo };
    },
    onError: (_error, _variables, context) => {
      if (collections && context?.previousUserInfo) {
        writeSyncedUserInfo(
          collections,
          context.previousUserInfo as unknown as Record<string, unknown>,
        );
      }
    },
    onSuccess: async (updatedUserInfo) => {
      if (collections) {
        writeSyncedUserInfo(
          collections,
          updatedUserInfo as unknown as Record<string, unknown>,
        );
      }
      await refetchSyncedShellCollections();
    },
  });

  const pendingSourceIdentity =
    togglePinnedSourceMutation.isPending && togglePinnedSourceMutation.variables
      ? getPinnedSourceIdentity(togglePinnedSourceMutation.variables.source)
      : null;

  function handleTogglePinnedSource(
    source: PinnedSource,
    action: "pin" | "unpin",
  ) {
    togglePinnedSourceMutation.mutate({
      action,
      source: toPinnedSource(source),
    });
  }

  return {
    currentUserInfo,
    pendingSourceIdentity,
    handleTogglePinnedSource,
  };
}

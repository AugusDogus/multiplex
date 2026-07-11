import {
  getNextPinnedSources,
  getPinnedSourceIdentity,
  type PinnedSource,
  type PlexUserInfo,
  toPinnedSource,
} from "@multiplex/plex-query";
import { api } from "~/trpc/react";

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
  const userInfoQuery = api.plex.getUserInfo.useQuery(undefined, {
    initialData: userInfo,
    staleTime: 60_000,
  });
  const currentUserInfo = userInfoQuery.data;
  const utils = api.useUtils();

  const togglePinnedSourceMutation = api.plex.togglePinnedSource.useMutation({
    scope: { id: "sidebar-pinning" },
    onMutate: async (variables) => {
      await utils.plex.getUserInfo.cancel();

      const previousUserInfo = utils.plex.getUserInfo.getData();
      utils.plex.getUserInfo.setData(
        undefined,
        applyPinnedSourceUpdate(
          previousUserInfo ?? userInfo,
          variables.source,
          variables.action,
        ),
      );

      return { previousUserInfo };
    },
    onError: (_error, _variables, context) => {
      utils.plex.getUserInfo.setData(
        undefined,
        context?.previousUserInfo ?? userInfo,
      );
    },
    onSuccess: async (updatedUserInfo) => {
      utils.plex.getUserInfo.setData(undefined, updatedUserInfo);
      await Promise.allSettled([
        utils.plex.getAllContinueWatching.invalidate(),
        utils.plex.getHomeHubs.invalidate(),
      ]);
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

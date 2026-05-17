import { useState } from "react";
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
  const [userInfoOverride, setUserInfoOverride] = useState<PlexUserInfo | null>(
    null,
  );
  const utils = api.useUtils();
  const currentUserInfo = userInfoOverride ?? userInfo;

  const togglePinnedSourceMutation = api.plex.togglePinnedSource.useMutation({
    onMutate: (variables) => {
      const previousUserInfo = userInfoOverride;

      setUserInfoOverride(
        applyPinnedSourceUpdate(
          currentUserInfo,
          variables.source,
          variables.action,
        ),
      );

      return { previousUserInfo };
    },
    onError: (_error, _variables, context) => {
      setUserInfoOverride(context?.previousUserInfo ?? null);
    },
    onSuccess: async (updatedUserInfo) => {
      setUserInfoOverride(updatedUserInfo);
      await utils.plex.getAllContinueWatching.invalidate();
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

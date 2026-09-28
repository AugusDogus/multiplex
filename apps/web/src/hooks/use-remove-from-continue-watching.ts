"use client";

import { toastManager } from "~/components/ui/toast-manager";
import { refetchSyncedContinueWatching } from "~/lib/sync-engine";
import { api } from "~/trpc/api";

export function useRemoveFromContinueWatching(
  item: { serverId: string; ratingKey: string },
  onRemoved?: () => void,
) {
  const mutation = api.plex.removeFromContinueWatching.useMutation({
    onSuccess: async (_data, variables) => {
      onRemoved?.();
      await refetchSyncedContinueWatching(variables.serverId).then(
        () =>
          toastManager.add({
            title: "Removed from Continue Watching",
            type: "success",
          }),
        () =>
          toastManager.add({
            title:
              "Removed from Continue Watching, but the list could not refresh",
            description: "Reload the page to see the updated list.",
            type: "error",
          }),
      );
    },
    onError: (error) => {
      toastManager.add({
        title: "Could not remove from Continue Watching",
        description: `${error.message} Try again.`,
        type: "error",
      });
    },
  });

  return {
    onRemove: () => {
      if (mutation.isPending) return;
      mutation.mutate({ serverId: item.serverId, ratingKey: item.ratingKey });
    },
    isPending: mutation.isPending,
  };
}

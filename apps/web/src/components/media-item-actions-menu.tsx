"use client";

import { Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { shallow } from "zustand/shallow";
import { getPlaylistTypeForItem } from "@multiplex/plex-query";

import { AddToPlaylistDialog } from "~/components/media-item-details/add-to-playlist-dialog";
import { MediaInfoDialog } from "~/components/media-item-details/media-info-dialog";
import type {
  ItemDetails,
  PlayTarget,
} from "~/components/media-item-details/types";
import { WatchTogetherInviteDialog } from "~/components/media-item-details/watch-together-invite-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast-manager";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import { getQueueActionDisabledReason } from "~/lib/media-item-actions";
import { useSyncedItemDetails } from "~/lib/sync-engine";
import { api } from "~/trpc/api";

const PLEX_ACTION_NOT_IMPLEMENTED =
  "This Plex action is disabled until the matching Plex behavior is implemented.";
const PLEX_ACTION_REQUIRES_SERVER =
  "This action needs an active server connection.";
const GET_INFO_REQUIRES_MEDIA =
  "Media info is only available once this item has playable media.";

interface MediaItemActionDetails {
  item: ItemDetails["item"];
  playTarget: PlayTarget;
  serverUrl: string | null | undefined;
  authToken: string | null | undefined;
}

interface MediaItemActionsMenuProps {
  serverId: string;
  ratingKey: string;
  title: string;
  details?: MediaItemActionDetails;
  presentation?: "hero" | "poster";
  onFeedback?: (message: string | null) => void;
}

export function MediaItemActionsMenu({
  serverId,
  ratingKey,
  title,
  details: providedDetails,
  presentation = "hero",
  onFeedback,
}: MediaItemActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [watchTogetherOpen, setWatchTogetherOpen] = useState(false);
  const { currentPlayerItem, playQueueId } = usePlayerStateSelector(
    (state) => ({
      currentPlayerItem: state.currentItem,
      playQueueId: state.playQueueId,
    }),
    shallow,
  );
  const needsDetails =
    open || mediaInfoOpen || addToPlaylistOpen || watchTogetherOpen;
  const detailsState = useSyncedItemDetails(serverId, ratingKey, {
    enabled: needsDetails && !providedDetails,
  });
  const updatePlayQueueMutation = api.plex.updatePlayQueue.useMutation();
  const details = providedDetails ?? detailsState.details;

  const queueType = details ? getPlaylistTypeForItem(details.item) : undefined;
  const activeQueueType = currentPlayerItem
    ? getPlaylistTypeForItem(currentPlayerItem)
    : undefined;
  const canWatchTogether = Boolean(
    details?.playTarget && details.serverUrl && details.authToken,
  );
  const hasMediaInfo = Boolean(details?.item.Media?.length);
  const queueActionDisabledReason = getQueueActionDisabledReason({
    targetType: queueType,
    activeType: activeQueueType,
    hasActiveQueue: Boolean(playQueueId),
    isSameServer: currentPlayerItem?.serverId === serverId,
    hasServerConnection: Boolean(details?.serverUrl && details.authToken),
    isPending: updatePlayQueueMutation.isPending,
  });

  const reportFeedback = (
    message: string,
    type: "error" | "success" | "info" = "info",
  ) => {
    if (onFeedback) {
      onFeedback(message);
      return;
    }

    toastManager.add({ title: message, type });
  };

  const updateActiveQueue = (next: boolean) => {
    if (
      !details ||
      !playQueueId ||
      !queueType ||
      queueType === "photo" ||
      queueType !== activeQueueType ||
      updatePlayQueueMutation.isPending
    ) {
      return;
    }

    const playbackIdentity = playerCommands.playbackIdentity();
    if (playbackIdentity?.serverId !== serverId) {
      return;
    }
    const activePlayQueueId = playQueueId;

    onFeedback?.(next ? "Adding to Play Next..." : "Adding to queue...");
    updatePlayQueueMutation.mutate(
      {
        serverId,
        playQueueId: activePlayQueueId,
        ratingKey: details.item.ratingKey,
        key: details.item.key,
        type: queueType,
        next,
      },
      {
        onSuccess: (updatedPlayQueue) => {
          if (playerCommands.snapshot().playQueueId !== activePlayQueueId) {
            return;
          }

          const wasApplied = playerCommands.updatePlaybackStateFor(
            playbackIdentity,
            {
              playQueue: updatedPlayQueue,
              playQueueId:
                updatedPlayQueue.MediaContainer.playQueueID.toString(),
            },
          );
          if (wasApplied) {
            reportFeedback(
              next ? "Will play next" : "Added to queue",
              "success",
            );
          }
        },
        onError: (error) => reportFeedback(error.message, "error"),
      },
    );
  };

  const trigger =
    presentation === "poster" ? (
      <Button
        variant="glass"
        size="icon-sm"
        className="rounded-full shadow-lg transition-transform duration-150 ease-out active:scale-[0.97]"
        aria-label={`More actions for ${title}`}
      />
    ) : (
      <Button variant="outline" size="icon" aria-label="More actions" />
    );

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={trigger}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {details ? (
              <>
                <DropdownMenuItem
                  onClick={() => setWatchTogetherOpen(true)}
                  disabled={!canWatchTogether}
                  aria-label={
                    canWatchTogether
                      ? undefined
                      : getDisabledMenuItemLabel(
                          "Watch Together...",
                          PLEX_ACTION_REQUIRES_SERVER,
                        )
                  }
                  title={
                    canWatchTogether ? undefined : PLEX_ACTION_REQUIRES_SERVER
                  }
                >
                  Watch Together...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => updateActiveQueue(true)}
                  disabled={Boolean(queueActionDisabledReason)}
                  aria-label={
                    queueActionDisabledReason
                      ? getDisabledMenuItemLabel(
                          "Play Next",
                          queueActionDisabledReason,
                        )
                      : undefined
                  }
                  title={queueActionDisabledReason}
                >
                  Play Next
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => updateActiveQueue(false)}
                  disabled={Boolean(queueActionDisabledReason)}
                  aria-label={
                    queueActionDisabledReason
                      ? getDisabledMenuItemLabel(
                          "Add to Queue",
                          queueActionDisabledReason,
                        )
                      : undefined
                  }
                  title={queueActionDisabledReason}
                >
                  Add to Queue
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddToPlaylistOpen(true)}>
                  Add to...
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled
                  aria-label={getDisabledMenuItemLabel(
                    "Report Issue...",
                    PLEX_ACTION_NOT_IMPLEMENTED,
                  )}
                  title={PLEX_ACTION_NOT_IMPLEMENTED}
                >
                  Report Issue...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMediaInfoOpen(true)}
                  disabled={!hasMediaInfo}
                  aria-label={
                    hasMediaInfo
                      ? undefined
                      : getDisabledMenuItemLabel(
                          "Get Info",
                          GET_INFO_REQUIRES_MEDIA,
                        )
                  }
                  title={hasMediaInfo ? undefined : GET_INFO_REQUIRES_MEDIA}
                >
                  Get Info
                </DropdownMenuItem>
              </>
            ) : detailsState.isError || detailsState.isComplete ? (
              <>
                <DropdownMenuItem disabled>
                  Could not load actions
                </DropdownMenuItem>
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={detailsState.retry}
                >
                  Try again
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled>
                <Loader2 className="animate-spin" />
                Loading actions...
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {details && (
        <>
          <MediaInfoDialog
            item={details.item}
            serverUrl={details.serverUrl ?? undefined}
            authToken={details.authToken ?? undefined}
            open={mediaInfoOpen}
            onOpenChange={setMediaInfoOpen}
          />
          <AddToPlaylistDialog
            item={details.item}
            serverId={serverId}
            playlistType={getPlaylistTypeForItem(details.item)}
            open={addToPlaylistOpen}
            onOpenChange={setAddToPlaylistOpen}
            onFeedback={(message) => reportFeedback(message)}
          />
          {details.serverUrl && details.authToken && (
            <WatchTogetherInviteDialog
              item={details.item}
              playTarget={details.playTarget}
              serverId={serverId}
              open={watchTogetherOpen}
              onOpenChange={setWatchTogetherOpen}
              onFeedback={(message) => reportFeedback(message)}
            />
          )}
        </>
      )}
    </>
  );
}

function getDisabledMenuItemLabel(label: string, reason: string): string {
  return label.endsWith(".") ? `${label} ${reason}` : `${label}. ${reason}`;
}

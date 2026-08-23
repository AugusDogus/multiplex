"use client";

import { Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { shallow } from "zustand/shallow";

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
import { api } from "~/trpc/api";

const PLEX_ACTION_NOT_IMPLEMENTED =
  "This Plex action is disabled until the matching Plex behavior is implemented.";
const QUEUE_ACTION_REQUIRES_PLAYER =
  "Start playback first to add items to the active queue.";
const QUEUE_ACTION_PENDING = "Updating the active Plex queue.";
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
  const utils = api.useUtils();
  const detailsQuery = api.plex.getItemDetails.useQuery(
    { serverId, ratingKey },
    {
      enabled: open && !providedDetails,
      staleTime: 60_000,
    },
  );
  const updatePlayQueueMutation = api.plex.updatePlayQueue.useMutation();
  const details = providedDetails ?? detailsQuery.data ?? undefined;
  const canWatchTogether = Boolean(
    details?.playTarget && details.serverUrl && details.authToken,
  );
  const hasMediaInfo = Boolean(details?.item.Media?.length);
  const canUpdateActiveQueue = Boolean(
    details?.serverUrl &&
      details.authToken &&
      playQueueId &&
      currentPlayerItem?.serverId === serverId,
  );
  const queueActionDisabledReason = getQueueActionDisabledReason(
    canUpdateActiveQueue,
    updatePlayQueueMutation.isPending,
  );

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

  const prefetchDetails = () => {
    if (providedDetails) {
      return;
    }

    void utils.plex.getItemDetails.prefetch(
      { serverId, ratingKey },
      { staleTime: 60_000 },
    );
  };

  const updateActiveQueue = (next: boolean) => {
    if (!details || !playQueueId || updatePlayQueueMutation.isPending) {
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
        type: "video",
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
        <DropdownMenuTrigger
          render={trigger}
          onFocus={prefetchDetails}
          onMouseEnter={prefetchDetails}
        >
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
            ) : detailsQuery.isError ? (
              <>
                <DropdownMenuItem disabled>
                  Could not load actions
                </DropdownMenuItem>
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={() => void detailsQuery.refetch()}
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

function getQueueActionDisabledReason(
  canUpdateActiveQueue: boolean,
  isPending: boolean,
): string | undefined {
  if (!canUpdateActiveQueue) {
    return QUEUE_ACTION_REQUIRES_PLAYER;
  }

  if (isPending) {
    return QUEUE_ACTION_PENDING;
  }

  return undefined;
}

function getDisabledMenuItemLabel(label: string, reason: string): string {
  return label.endsWith(".") ? `${label} ${reason}` : `${label}. ${reason}`;
}

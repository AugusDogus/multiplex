"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MoreHorizontal, Play, Share2 } from "lucide-react";
import {
  formatDetailsTimeRemaining,
  getBackdropImagePath,
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataTypeLabel,
  getPlayButtonLabel,
  getPosterImagePath,
  getPlexImageUrl,
  type PlayableMetadata,
} from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { api } from "~/trpc/react";

import { AddToPlaylistDialog } from "./add-to-playlist-dialog";
import { MediaInfoDialog } from "./media-info-dialog";
import { MetadataDirectors } from "./metadata-directors";
import { MetadataGenres } from "./metadata-genres";
import { MetadataRating } from "./metadata-rating";
import { MetadataSummaryRow } from "./metadata-summary-row";
import type { ItemDetails, PlayTarget } from "./types";

const SHARE_FEEDBACK_MS = 2_500;
const PLEX_ACTION_NOT_IMPLEMENTED =
  "This Plex action is disabled until the matching Plex behavior is implemented.";
const QUEUE_ACTION_REQUIRES_PLAYER =
  "Start playback first to add items to the active queue.";
const QUEUE_ACTION_PENDING = "Updating the active Plex queue.";
const PLEX_ACTION_REQUIRES_SERVER =
  "This action needs an active server connection.";
const GET_INFO_REQUIRES_MEDIA =
  "Media info is only available once this item has playable media.";

interface DetailsHeroProps {
  item: ItemDetails["item"];
  serverId: string;
  serverName: string | null | undefined;
  serverUrl: string | null | undefined;
  authToken: string | null | undefined;
  playTarget: PlayTarget;
  onPlay: (source: PlayableMetadata) => void;
}

export function DetailsHero({
  item,
  serverId,
  serverName,
  serverUrl,
  authToken,
  playTarget,
  onPlay,
}: DetailsHeroProps) {
  const imageServerUrl = serverUrl ?? undefined;
  const imageAuthToken = authToken ?? undefined;
  const posterUrl = getPlexImageUrl(
    getPosterImagePath(item),
    imageServerUrl,
    imageAuthToken,
    { width: 440, height: 660 },
  );
  const backdropUrl = getPlexImageUrl(
    getBackdropImagePath(item),
    imageServerUrl,
    imageAuthToken,
    { width: 1280, height: 720 },
  );
  const timeRemaining = formatDetailsTimeRemaining(item);
  const secondaryTitle = getDetailsSecondaryTitle(item);
  const canPlay = Boolean(imageServerUrl && imageAuthToken && playTarget);
  const playLabel = getPlayButtonLabel(playTarget);

  const actions = (
    <HeroActions
      item={item}
      serverId={serverId}
      playTarget={playTarget}
      onPlay={onPlay}
      canPlay={canPlay}
      playLabel={playLabel}
      serverUrl={imageServerUrl}
      authToken={imageAuthToken}
    />
  );

  return (
    <>
      <section className="relative hidden rounded-2xl border-transparent mask-[linear-gradient(#000_0_0)] [-webkit-mask:linear-gradient(#000_0_0)] lg:block">
        {backdropUrl && (
          <Image
            src={backdropUrl}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 1200px, 100vw"
            className="-z-20 object-cover"
          />
        )}
        <div className="from-background via-background/90 to-background/40 absolute inset-0 -z-10 bg-linear-to-r" />
        <div className="from-background via-background/30 absolute inset-0 -z-10 bg-linear-to-t to-transparent" />

        <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:p-8">
          <div className="flex w-full flex-col gap-3 sm:w-[220px] lg:shrink-0">
            <HeroPoster
              posterUrl={posterUrl}
              title={item.title}
              sizes="220px"
              iconClassName="size-12"
              className="bg-muted ring-border relative aspect-2/3 rounded-xl mask-[linear-gradient(#000_0_0)] shadow-2xl ring-1 [-webkit-mask:linear-gradient(#000_0_0)]"
            />
            {timeRemaining && (
              <div className="bg-muted rounded-md px-3 py-2 text-center text-sm font-medium">
                {timeRemaining}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-start gap-5 lg:max-w-3xl">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {getMetadataTypeLabel(item.type)}
                </Badge>
                <Badge variant="outline">{item.librarySectionTitle}</Badge>
                <Badge variant="outline">{serverName ?? "Plex server"}</Badge>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                {getMainTitle(item)}
              </h1>
              {secondaryTitle && (
                <p className="text-muted-foreground text-xl sm:text-2xl">
                  {secondaryTitle}
                </p>
              )}
              <MetadataDirectors item={item} />
              <MetadataSummaryRow item={item} serverId={serverId} />
              <MetadataGenres item={item} />
              <MetadataRating item={item} />
            </div>

            <div className="flex flex-wrap items-center gap-2">{actions}</div>

            {item.summary && (
              <p className="text-muted-foreground max-w-3xl text-sm leading-6 sm:text-base">
                {item.summary}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="relative -mx-4 overflow-hidden lg:hidden">
        {backdropUrl && (
          <Image
            src={backdropUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="-z-20 object-cover"
          />
        )}
        <div className="from-background via-background/96 to-background/75 absolute inset-0 -z-10 bg-linear-to-t" />

        <div className="relative grid grid-cols-[108px_minmax(0,1fr)] gap-x-4 gap-y-4 px-4 py-5">
          <div className="flex flex-col gap-2 self-start">
            <HeroPoster
              posterUrl={posterUrl}
              title={item.title}
              sizes="108px"
              iconClassName="size-10"
              className="bg-muted ring-border relative aspect-2/3 overflow-hidden rounded-lg shadow-2xl ring-1"
            />
            {timeRemaining && (
              <div className="bg-primary text-primary-foreground rounded-md px-2 py-1.5 text-center text-xs font-semibold shadow-sm">
                {timeRemaining}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-2 self-center">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {getMainTitle(item)}
            </h1>
            {secondaryTitle && (
              <p className="text-foreground/75 text-base">{secondaryTitle}</p>
            )}
            <MetadataDirectors item={item} />
            <MetadataSummaryRow item={item} serverId={serverId} />
            <MetadataGenres item={item} />
            <MetadataRating item={item} />
          </div>

          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <HeroActions
              item={item}
              serverId={serverId}
              playTarget={playTarget}
              onPlay={onPlay}
              canPlay={canPlay}
              playLabel={playLabel}
              playButtonClassName="min-h-11 flex-1"
              serverUrl={imageServerUrl}
              authToken={imageAuthToken}
            />
          </div>
        </div>
      </section>
    </>
  );
}

interface HeroPosterProps {
  posterUrl: string | undefined;
  title: string;
  sizes: string;
  iconClassName: string;
  className: string;
}

function HeroPoster({
  posterUrl,
  title,
  sizes,
  iconClassName,
  className,
}: HeroPosterProps) {
  return (
    <div className={className}>
      {posterUrl ? (
        <Image
          src={posterUrl}
          alt={`${title} poster`}
          fill
          priority
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Play className={`text-muted-foreground ${iconClassName}`} />
        </div>
      )}
    </div>
  );
}

interface HeroActionsProps {
  item: ItemDetails["item"];
  serverId: string;
  playTarget: PlayTarget;
  onPlay: (source: PlayableMetadata) => void;
  canPlay: boolean;
  playLabel: string;
  serverUrl: string | undefined;
  authToken: string | undefined;
  playButtonClassName?: string;
}

function HeroActions({
  item,
  serverId,
  playTarget,
  onPlay,
  canPlay,
  playLabel,
  serverUrl,
  authToken,
  playButtonClassName,
}: HeroActionsProps) {
  const utils = api.useUtils();
  const currentPlayerItem = useMediaPlayerStore((state) => state.currentItem);
  const playQueueId = useMediaPlayerStore((state) => state.playQueueId);
  const updatePlaybackState = useMediaPlayerStore(
    (state) => state.updatePlaybackState,
  );
  const itemWatched = getItemWatchedState(item);
  const [confirmedWatchedOverride, setConfirmedWatchedOverride] = useState<{
    ratingKey: string;
    watched: boolean;
  } | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const shareResetTimeoutRef = useRef<number | null>(null);
  const hasMediaInfo = Boolean(item.Media?.length);
  const canAddToPlaylist = Boolean(serverUrl && authToken);
  const visibleWatched =
    confirmedWatchedOverride?.ratingKey === item.ratingKey
      ? confirmedWatchedOverride.watched
      : itemWatched;
  const watchedActionLabel = visibleWatched
    ? "Mark as unwatched"
    : "Mark as watched";
  const watchedPendingLabel = visibleWatched
    ? "Marking as unwatched"
    : "Marking as watched";
  const canUpdateActiveQueue = Boolean(
    serverUrl &&
      authToken &&
      playQueueId &&
      currentPlayerItem?.serverId === serverId,
  );

  useEffect(() => {
    return () => {
      if (shareResetTimeoutRef.current) {
        window.clearTimeout(shareResetTimeoutRef.current);
      }
    };
  }, []);

  const setWatchedStateMutation = api.plex.setItemWatchedState.useMutation({
    onError: (error) => {
      setFeedbackMessage(error.message);
    },
    onSuccess: (_updatedItem, variables) => {
      setConfirmedWatchedOverride({
        ratingKey: variables.ratingKey,
        watched: variables.watched,
      });
      setFeedbackMessage(
        variables.watched ? "Marked as watched" : "Marked as unwatched",
      );
      void Promise.all([
        utils.plex.getItemDetails.invalidate({
          serverId,
          ratingKey: variables.ratingKey,
        }),
        utils.plex.getItemMetadata.invalidate({
          serverId,
          ratingKey: variables.ratingKey,
        }),
        utils.plex.getAllContinueWatching.invalidate(),
      ]).catch(() => undefined);
    },
  });

  const updatePlayQueueMutation = api.plex.updatePlayQueue.useMutation({
    onSuccess: (playQueue, variables) => {
      updatePlaybackState({
        playQueue,
        playQueueId: playQueue.MediaContainer.playQueueID.toString(),
      });
      setFeedbackMessage(variables.next ? "Will play next" : "Added to queue");
    },
    onError: (error) => {
      setFeedbackMessage(error.message);
    },
  });

  const watchedButtonLabel = setWatchedStateMutation.isPending
    ? watchedPendingLabel
    : watchedActionLabel;
  const queueActionDisabledReason = getQueueActionDisabledReason(
    canUpdateActiveQueue,
    updatePlayQueueMutation.isPending,
  );
  const shareButtonLabel = shareCopied ? "Copied" : "Share";
  const shareActionLabel = shareCopied ? "Link copied" : "Copy share link";

  const toggleWatchedState = () => {
    if (setWatchedStateMutation.isPending) {
      return;
    }

    setFeedbackMessage(watchedPendingLabel);
    setWatchedStateMutation.mutate({
      serverId,
      ratingKey: item.ratingKey,
      watched: !visibleWatched,
      serverUrl,
      authToken,
    });
  };

  const updateActiveQueue = (next: boolean) => {
    if (
      !serverUrl ||
      !authToken ||
      !playQueueId ||
      updatePlayQueueMutation.isPending
    ) {
      return;
    }

    setFeedbackMessage(next ? "Adding to Play Next..." : "Adding to queue...");
    updatePlayQueueMutation.mutate({
      serverId,
      serverUrl,
      authToken,
      playQueueId,
      ratingKey: item.ratingKey,
      key: item.key,
      type: "video",
      next,
    });
  };

  const copyShareLink = () => {
    const shareUrl = window.location.href;

    if (shareResetTimeoutRef.current) {
      window.clearTimeout(shareResetTimeoutRef.current);
    }

    if (!navigator.clipboard) {
      setShareCopied(false);
      setFeedbackMessage("Could not copy link");
      return;
    }

    // The in-button "Copied" state is the only confirmation we need; clear any
    // stale status text rather than duplicating it beneath the actions.
    setFeedbackMessage(null);
    setShareCopied(true);
    shareResetTimeoutRef.current = window.setTimeout(() => {
      setShareCopied(false);
      shareResetTimeoutRef.current = null;
    }, SHARE_FEEDBACK_MS);

    void navigator.clipboard.writeText(shareUrl).catch(() => {
      if (shareResetTimeoutRef.current) {
        window.clearTimeout(shareResetTimeoutRef.current);
        shareResetTimeoutRef.current = null;
      }
      setShareCopied(false);
      setFeedbackMessage("Could not copy link");
    });
  };

  return (
    <>
      <Button
        size="lg"
        className={playButtonClassName}
        onClick={() => playTarget && onPlay(playTarget)}
        disabled={!canPlay}
      >
        <Play data-icon="inline-start" />
        {playLabel}
      </Button>
      <Button
        variant={visibleWatched ? "secondary" : "outline"}
        size="icon"
        aria-label={watchedButtonLabel}
        aria-busy={setWatchedStateMutation.isPending || undefined}
        title={watchedButtonLabel}
        onClick={toggleWatchedState}
        disabled={setWatchedStateMutation.isPending}
      >
        {setWatchedStateMutation.isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Check className={visibleWatched ? "text-primary" : undefined} />
        )}
      </Button>
      <Button
        variant={shareCopied ? "secondary" : "outline"}
        size="default"
        aria-label={shareActionLabel}
        title={shareActionLabel}
        onClick={copyShareLink}
      >
        {shareCopied ? (
          <Check data-icon="inline-start" />
        ) : (
          <Share2 data-icon="inline-start" />
        )}
        <span className="min-w-14 text-center">{shareButtonLabel}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled
              aria-label={getDisabledMenuItemLabel(
                "Watch Together...",
                PLEX_ACTION_NOT_IMPLEMENTED,
              )}
              title={PLEX_ACTION_NOT_IMPLEMENTED}
            >
              Watch Together...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => updateActiveQueue(true)}
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
              onSelect={() => updateActiveQueue(false)}
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
            <DropdownMenuItem
              onSelect={() => setAddToPlaylistOpen(true)}
              disabled={!canAddToPlaylist}
              aria-label={
                canAddToPlaylist
                  ? undefined
                  : getDisabledMenuItemLabel(
                      "Add to...",
                      PLEX_ACTION_REQUIRES_SERVER,
                    )
              }
              title={canAddToPlaylist ? undefined : PLEX_ACTION_REQUIRES_SERVER}
            >
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
              onSelect={() => setMediaInfoOpen(true)}
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
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <MediaInfoDialog
        item={item}
        serverUrl={serverUrl}
        authToken={authToken}
        open={mediaInfoOpen}
        onOpenChange={setMediaInfoOpen}
      />
      {serverUrl && authToken && (
        <AddToPlaylistDialog
          item={item}
          serverId={serverId}
          serverUrl={serverUrl}
          authToken={authToken}
          open={addToPlaylistOpen}
          onOpenChange={setAddToPlaylistOpen}
          onFeedback={setFeedbackMessage}
        />
      )}
      {feedbackMessage && (
        <span
          className="text-muted-foreground basis-full text-sm"
          role="status"
        >
          {feedbackMessage}
        </span>
      )}
    </>
  );
}

function getItemWatchedState(item: ItemDetails["item"]): boolean {
  if (
    typeof item.leafCount === "number" &&
    typeof item.viewedLeafCount === "number"
  ) {
    return item.leafCount > 0 && item.viewedLeafCount >= item.leafCount;
  }

  return (item.viewCount ?? 0) > 0;
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

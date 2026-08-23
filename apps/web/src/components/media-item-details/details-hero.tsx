"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, Share2 } from "lucide-react";
import {
  formatDetailsTimeRemaining,
  getBackdropImagePath,
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataTypeLabel,
  getPlayButtonLabel,
  getPosterImagePath,
  type PlayableMetadata,
} from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { MediaItemActionsMenu } from "~/components/media-item-actions-menu";
import { getPlexImagePath } from "~/lib/plex-image";
import {
  refetchSyncedMediaItem,
  refetchSyncedShellCollections,
} from "~/lib/sync-engine";
import { api } from "~/trpc/api";

import { MetadataDirectors } from "./metadata-directors";
import { MetadataGenres } from "./metadata-genres";
import { MetadataRating } from "./metadata-rating";
import { MetadataSummaryRow } from "./metadata-summary-row";
import type { ItemDetails, PlayTarget } from "./types";

const SHARE_FEEDBACK_MS = 2_500;

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
  const posterUrl = getPlexImagePath(getPosterImagePath(item), {
    width: 440,
    height: 660,
    serverUrl: imageServerUrl,
    authToken: imageAuthToken,
  });
  const backdropUrl = getPlexImagePath(getBackdropImagePath(item), {
    width: 1280,
    height: 720,
    serverUrl: imageServerUrl,
    authToken: imageAuthToken,
  });
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
  const itemWatched = getItemWatchedState(item);
  const [confirmedWatchedOverride, setConfirmedWatchedOverride] = useState<{
    ratingKey: string;
    watched: boolean;
  } | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const shareResetTimeoutRef = useRef<number | null>(null);
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
        refetchSyncedMediaItem(serverId, variables.ratingKey),
        refetchSyncedShellCollections(),
      ]).catch((error) => {
        console.error("Failed to resync after watched-state change:", error);
      });
    },
  });

  const watchedButtonLabel = setWatchedStateMutation.isPending
    ? watchedPendingLabel
    : watchedActionLabel;
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
      <MediaItemActionsMenu
        serverId={serverId}
        ratingKey={item.ratingKey}
        title={item.title}
        details={{ item, playTarget, serverUrl, authToken }}
        onFeedback={setFeedbackMessage}
      />
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
  if (item.leafCount !== undefined && item.viewedLeafCount !== undefined) {
    return item.leafCount > 0 && item.viewedLeafCount >= item.leafCount;
  }

  return (item.viewCount ?? 0) > 0;
}

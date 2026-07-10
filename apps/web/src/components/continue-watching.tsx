"use client";

import React, { useState } from "react";
import {
  getMainTitle,
  getSubtitle,
  getThumbnailUrl,
  isCompleted,
  toPlayableMetadata,
  type ContinueWatchingItemWithServer,
} from "@multiplex/plex-query";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Option from "effect/Option";

import { ContinueWatchingDrawer } from "~/components/continue-watching-drawer";
import { MediaCarousel } from "~/components/media-carousel";
import { MediaPosterCard } from "~/components/media-poster-card";
import { useItemDetailsNavigation } from "~/hooks/use-item-details-navigation";
import { useVisibilityChange } from "~/hooks/use-visibility-change";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import type { ContinueWatchingResult } from "~/lib/effect/plex-boundary";
import { continueWatchingAtom } from "~/lib/effect/plex-browse-atoms";
import { playerCommands } from "~/lib/effect/player-atoms";
import { useProgressStore } from "~/stores/progress-store";

/* ────────────────────────────────────────────────────────────
   Continue Watching Component
   Horizontal slider of poster items with progress
   ──────────────────────────────────────────────────────────── */

interface SectionWrapperProps {
  children: React.ReactNode;
}

function SectionWrapper({ children }: SectionWrapperProps) {
  return <div className="flex flex-col gap-y-4">{children}</div>;
}

/** Unsubscribes from `continueWatchingAtom` so `withRefresh` stops polling. */
const pausedContinueWatchingAtom = Atom.make(() => AsyncResult.initial(false));

export interface ContinueWatchingProps {
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Custom title for the section */
  title?: string;
  /**
   * Kept for API compatibility. Cadence is owned by `continueWatchingAtom`
   * (`Atom.withRefresh` at 5s); non-default values are ignored — report if a
   * caller needs a different interval.
   */
  refreshInterval?: number;
  /** Whether to enable auto-refresh (default: true) */
  enableAutoRefresh?: boolean;
}

export function ContinueWatching({
  showTitle = true,
  title = "Continue Watching",
  refreshInterval: _refreshInterval = 5000,
  enableAutoRefresh = true,
}: ContinueWatchingProps) {
  const isPageVisible = useVisibilityChange();
  // Unsubscribe when hidden / auto-refresh off so Atom.withRefresh's timer
  // finalizes (matches former refetchInterval: false gating).
  const shouldPoll = enableAutoRefresh && isPageVisible;
  const itemsResult = useAtomValue(
    shouldPoll ? continueWatchingAtom : pausedContinueWatchingAtom,
  );
  const [cachedItems, setCachedItems] = useState<ContinueWatchingResult>([]);

  const liveItems = Option.getOrElse(
    AsyncResult.value(itemsResult),
    (): ContinueWatchingResult => [],
  );
  // Adjust cached snapshot during render when the live atom settles (React's
  // recommended pattern for deriving state from previous renders).
  if (
    shouldPoll &&
    (AsyncResult.isSuccess(itemsResult) || liveItems.length > 0) &&
    cachedItems !== liveItems
  ) {
    setCachedItems(liveItems);
  }

  const items = shouldPoll
    ? liveItems.length > 0 || AsyncResult.isSuccess(itemsResult)
      ? liveItems
      : cachedItems
    : cachedItems;
  const isLoading =
    shouldPoll && isAsyncResultLoading(itemsResult) && items.length === 0;
  const hasError =
    shouldPoll && AsyncResult.isFailure(itemsResult) && items.length === 0;

  if (isLoading) {
    return (
      <SectionWrapper>
        {showTitle ? (
          <h2 className="px-4 text-2xl font-semibold tracking-tight md:px-8">
            {title}
          </h2>
        ) : null}
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Loading Continue Watching…
        </div>
      </SectionWrapper>
    );
  }

  if (hasError) {
    return (
      <SectionWrapper>
        {showTitle ? (
          <h2 className="px-4 text-2xl font-semibold tracking-tight md:px-8">
            {title}
          </h2>
        ) : null}
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Failed to load Continue Watching data
        </div>
      </SectionWrapper>
    );
  }

  if (items.length === 0) {
    return (
      <SectionWrapper>
        {showTitle ? (
          <h2 className="px-4 text-2xl font-semibold tracking-tight md:px-8">
            {title}
          </h2>
        ) : null}
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Nothing to continue watching. Start watching something to see it here.
        </div>
      </SectionWrapper>
    );
  }

  return (
    <MediaCarousel
      header={
        showTitle ? (
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        ) : undefined
      }
    >
      {items.map((item) => (
        <ContinueWatchingItem
          key={`${item.serverId}-${item.ratingKey}`}
          item={item}
        />
      ))}
    </MediaCarousel>
  );
}

/* ────────────────────────────────────────────────────────────
   Continue Watching Item Component
   Individual poster item with metadata and progress
   ──────────────────────────────────────────────────────────── */

interface ContinueWatchingItemProps {
  item: ContinueWatchingItemWithServer;
}

function ContinueWatchingItem({ item }: ContinueWatchingItemProps) {
  const itemDetailsNavigation = useItemDetailsNavigation();
  const getItemProgress = useProgressStore((state) => state.getItemProgress);
  const updateItemProgress = useProgressStore(
    (state) => state.updateItemProgress,
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const detailsTarget = {
    serverId: item.serverId,
    type: item.type,
    ratingKey: item.ratingKey,
  };

  // Use updated progress if available, otherwise use server data
  const progressPercent: number =
    getItemProgress(item.ratingKey) ?? item.progressPercent ?? 0;
  const isItemCompleted = isCompleted(item);

  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const canPlay = Boolean(
    toPlayableMetadata(item) && item.serverUrl && item.authToken,
  );

  const handlePlay = () => {
    const playable = toPlayableMetadata(item);

    if (!playable || !item.serverUrl || !item.authToken) {
      console.error("Missing server URL or auth token for media playback");
      return;
    }

    playerCommands.openPlayer(
      createMediaPlayerItem(playable, {
        serverId: item.serverId,
        serverUrl: item.serverUrl,
        authToken: item.authToken,
      }),
    );
  };

  const handlePlayFromDrawer = () => {
    setIsDrawerOpen(false);
    handlePlay();
  };

  const handleRestartFromBeginning = () => {
    const playable = toPlayableMetadata(item);

    if (!playable || !item.serverUrl || !item.authToken) {
      console.error("Missing server URL or auth token for media playback");
      return;
    }

    updateItemProgress({
      ratingKey: item.ratingKey,
      progressPercent: 0,
    });

    setIsDrawerOpen(false);
    playerCommands.openPlayer(
      createMediaPlayerItem(
        { ...playable, viewOffset: 0 },
        {
          serverId: item.serverId,
          serverUrl: item.serverUrl,
          authToken: item.authToken,
        },
      ),
    );
  };

  const handleViewDetails = () => {
    setIsDrawerOpen(false);
    itemDetailsNavigation.navigate(detailsTarget);
  };

  // On mobile, tapping the poster/metadata opens the options drawer instead of
  // navigating. The decision is made at click time so a single <Link> can serve
  // both viewports without a hydration flash or a JS breakpoint hook.
  const handleNavigateClick = (event: React.MouseEvent) => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      event.preventDefault();
      setIsDrawerOpen(true);
    }
  };

  return (
    <>
      <MediaPosterCard
        title={mainTitle}
        subtitle={subtitle}
        detailsTarget={detailsTarget}
        thumbnailUrl={thumbnailUrl}
        progressPercent={progressPercent}
        isCompleted={isItemCompleted}
        showPlayOverlay={canPlay}
        onPlay={handlePlay}
        onNavigateClick={handleNavigateClick}
        showMobileMenuHint
      />

      <ContinueWatchingDrawer
        item={item}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        progressPercent={progressPercent}
        thumbnailUrl={thumbnailUrl}
        canPlay={canPlay}
        onPlay={handlePlayFromDrawer}
        onRestart={handleRestartFromBeginning}
        onViewDetails={handleViewDetails}
      />
    </>
  );
}

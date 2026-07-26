"use client";

import React, { useState } from "react";
import {
  getMainTitle,
  getPosterImagePath,
  getSubtitle,
  isCompleted,
  toPlayableMetadata,
  type ContinueWatchingItemWithServer,
} from "@multiplex/plex-query";
import { playerCommands } from "~/lib/effect/player-atoms";
import { ContinueWatchingDrawer } from "~/components/continue-watching-drawer";
import { MediaCarousel } from "~/components/media-carousel";
import { ContinueWatchingSkeleton } from "~/components/media-carousel-skeleton";
import { MediaPosterCard } from "~/components/media-poster-card";
import { useItemDetailsNavigation } from "~/hooks/use-item-details-navigation";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { isHubQueryLoading } from "~/lib/plex-hub-query-options";
import { getPlexImagePath } from "~/lib/plex-image";
import {
  resetSyncedContinueWatchingProgress,
  toContinueWatchingItemWithServer,
  useSyncedContinueWatching,
} from "~/lib/sync-engine";

/* ────────────────────────────────────────────────────────────
   Continue Watching Component
   Horizontal slider of poster items with progress
   Reads from the TanStack DB sync-engine replica (OPFS-backed).
   ──────────────────────────────────────────────────────────── */

interface SectionWrapperProps {
  children: React.ReactNode;
}

function SectionWrapper({ children }: SectionWrapperProps) {
  return <div className="flex flex-col gap-y-4">{children}</div>;
}

export interface ContinueWatchingProps {
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Custom title for the section */
  title?: string;
  /** Auto-refresh interval in milliseconds (default: 30000ms) */
  refreshInterval?: number;
  /** Whether to enable auto-refresh (default: true) */
  enableAutoRefresh?: boolean;
}

export function ContinueWatching({
  showTitle = true,
  title = "Continue Watching",
  // Kept for API compatibility; sync-engine collection owns the 30s refetch.
  refreshInterval: _refreshInterval = 30_000,
  enableAutoRefresh: _enableAutoRefresh = true,
}: ContinueWatchingProps) {
  void _refreshInterval;
  void _enableAutoRefresh;
  const { data: rows, isLoading, isReady } = useSyncedContinueWatching();

  const items = rows.map(toContinueWatchingItemWithServer);
  const isPending = !isReady || (isLoading && items.length === 0);
  const isFetching = Boolean(isLoading && items.length > 0);

  if (isHubQueryLoading(isPending, isFetching, items.length)) {
    return (
      <ContinueWatchingSkeleton
        header={
          showTitle ? (
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          ) : undefined
        }
        showTitle={false}
      />
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
      {items.map((item, index) => (
        <ContinueWatchingItem
          key={`${item.serverId}-${item.ratingKey}`}
          item={item}
          priority={index < 6}
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
  priority?: boolean;
}

function ContinueWatchingItem({
  item,
  priority = false,
}: ContinueWatchingItemProps) {
  const itemDetailsNavigation = useItemDetailsNavigation();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const detailsTarget = {
    serverId: item.serverId,
    type: item.type,
    ratingKey: item.ratingKey,
  };

  const progressPercent = item.progressPercent ?? 0;
  const isItemCompleted = isCompleted(item);

  const thumbnailUrl = getPlexImagePath(getPosterImagePath(item), {
    width: 200,
    height: 300,
    serverUrl: item.serverUrl,
    authToken: item.authToken,
  });

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

    resetSyncedContinueWatchingProgress({
      serverId: item.serverId,
      ratingKey: item.ratingKey,
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
      { resume: false },
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
        priority={priority}
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

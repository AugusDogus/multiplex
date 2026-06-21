"use client";

import { useRouter } from "next/navigation";
import React, { useState } from "react";
import {
  getMainTitle,
  getSubtitle,
  getThumbnailUrl,
  isCompleted,
  toPlayableMetadata,
  type ContinueWatchingItemWithServer,
} from "@multiplex/plex-query";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useProgressStore } from "~/stores/progress-store";
import { ContinueWatchingDrawer } from "~/components/continue-watching-drawer";
import { MediaCarousel } from "~/components/media-carousel";
import { MediaPosterCard } from "~/components/media-poster-card";
import { useVisibilityChange } from "~/hooks/use-visibility-change";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { isHubQueryLoading } from "~/lib/plex-hub-query-options";
import { api } from "~/trpc/react";

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

export interface ContinueWatchingProps {
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Custom title for the section */
  title?: string;
  /** Auto-refresh interval in milliseconds (default: 5000ms) */
  refreshInterval?: number;
  /** Whether to enable auto-refresh (default: true) */
  enableAutoRefresh?: boolean;
}

export function ContinueWatching({
  showTitle = true,
  title = "Continue Watching",
  refreshInterval = 5000,
  enableAutoRefresh = true,
}: ContinueWatchingProps) {
  const isPageVisible = useVisibilityChange();

  const {
    data: items = [],
    error,
    isPending,
    isFetching,
  } = api.plex.getAllContinueWatching.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: refreshInterval * 4,
    refetchInterval:
      enableAutoRefresh && isPageVisible ? refreshInterval : false,
    retry: (failureCount: number, error: unknown) => {
      if (failureCount >= 3) return false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("401") || errorMessage.includes("403"))
        return false;
      return true;
    },
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  if (isHubQueryLoading(isPending, isFetching, items.length) && !error) {
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

  if (error && items.length === 0) {
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
  const router = useRouter();
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const getItemProgress = useProgressStore((state) => state.getItemProgress);
  const updateItemProgress = useProgressStore(
    (state) => state.updateItemProgress,
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const detailsHref = getItemDetailsHref(item.serverId, item.ratingKey);

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

    openPlayer(
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
    openPlayer(
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
    router.push(detailsHref);
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
        detailsHref={detailsHref}
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

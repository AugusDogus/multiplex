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
import { MediaPosterCard } from "~/components/media-poster-card";
import { useVisibilityChange } from "~/hooks/use-visibility-change";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { api, type RouterOutputs } from "~/trpc/react";

/* ────────────────────────────────────────────────────────────
   Continue Watching Component
   Horizontal slider of poster items with progress
   ──────────────────────────────────────────────────────────── */

// Wrapper component to avoid repeating the same container classes
interface SectionWrapperProps {
  children: React.ReactNode;
  showTitle?: boolean;
  title?: string;
}

function SectionWrapper({ children, showTitle, title }: SectionWrapperProps) {
  return (
    <div className="flex flex-col gap-y-4">
      {showTitle && (
        <div className="flex items-center justify-between px-4 md:px-8">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

export interface ContinueWatchingProps {
  /** Initial Continue Watching items from server-side rendering */
  items: RouterOutputs["plex"]["getAllContinueWatching"];
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
  items: initialItems,
  showTitle = true,
  title = "Continue Watching",
  refreshInterval = 5000,
  enableAutoRefresh = true,
}: ContinueWatchingProps) {
  const isPageVisible = useVisibilityChange();

  // Use tRPC query for auto-refresh, seeded with the server-rendered items so
  // the section paints immediately instead of waiting for the first client fetch.
  const { data: items, error } = api.plex.getAllContinueWatching.useQuery(
    undefined,
    {
      initialData: initialItems,
      // Only refetch when page is visible and auto-refresh is enabled
      refetchInterval:
        enableAutoRefresh && isPageVisible ? refreshInterval : false,
      // Don't refetch on window focus to avoid excessive requests
      refetchOnWindowFocus: false,
      // Keep data fresh but don't show loading state during background refresh
      staleTime: refreshInterval / 2, // Consider data stale after half the refresh interval
      // Keep data in cache for longer than stale time
      gcTime: refreshInterval * 4, // Keep in cache for 4x the refresh interval
      // Retry failed requests with exponential backoff
      retry: (failureCount: number, error: unknown) => {
        // Don't retry more than 3 times
        if (failureCount >= 3) return false;
        // Don't retry on auth errors (401, 403)
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("401") || errorMessage.includes("403"))
          return false;
        return true;
      },
      retryDelay: (attemptIndex: number) =>
        Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff, max 30s
    },
  );

  // Only show error when we have nothing to display at all
  if (error && items.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Failed to load Continue Watching data
        </div>
      </SectionWrapper>
    );
  }

  if (items.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Nothing to continue watching. Start watching something to see it here.
        </div>
      </SectionWrapper>
    );
  }

  return (
    <SectionWrapper showTitle={showTitle} title={title}>
      <div className="w-full max-w-full overflow-hidden">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 pb-4 md:px-8">
          {items.map((item) => (
            <ContinueWatchingItem
              key={`${item.serverId}-${item.ratingKey}`}
              item={item}
            />
          ))}
        </div>
      </div>
    </SectionWrapper>
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

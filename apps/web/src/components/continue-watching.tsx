"use client";

import { CirclePlay, MoreHorizontal, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
import { Button } from "~/components/ui/button";
import { ContinueWatchingDrawer } from "~/components/continue-watching-drawer";
import { MediaProgressBar } from "~/components/media-progress-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { useVisibilityChange } from "~/hooks/use-visibility-change";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { api } from "~/trpc/react";

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
  items: ContinueWatchingItemWithServer[];
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

  // Use tRPC query for auto-refresh - fetch fresh data immediately for type safety
  const {
    data: continueWatchingData,
    error,
    isLoading,
  } = api.plex.getAllContinueWatching.useQuery(undefined, {
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
  });

  // Use fresh data from query, fallback to initial items
  const items = continueWatchingData ?? initialItems;

  // Only show error for initial load failures, not background refresh failures
  if (error && !continueWatchingData && initialItems.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="text-muted-foreground px-4 text-sm md:px-8">
          Failed to load Continue Watching data
        </div>
      </SectionWrapper>
    );
  }

  // Only show loading state for initial load, not for background refresh
  if (isLoading && !continueWatchingData) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="w-full max-w-full overflow-hidden">
          <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 pb-4 md:px-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <ContinueWatchingItemSkeleton key={i} />
            ))}
          </div>
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

  // Generate thumbnail URL using Plex photo transcoding service
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
  const handleAnchorClick = (event: React.MouseEvent) => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      event.preventDefault();
      setIsDrawerOpen(true);
    }
  };

  const posterContent = (
    <>
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={mainTitle}
          className="h-full w-full object-cover"
          loading="lazy"
          width={160}
          height={240}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <CirclePlay className="text-muted-foreground h-12 w-12" />
        </div>
      )}

      {progressPercent > 0 && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-black/60 to-transparent" />
          <MediaProgressBar
            value={progressPercent}
            className="absolute right-0 bottom-0 left-0 h-1 bg-black/40"
            fillClassName="bg-primary transition-all duration-300"
          />
        </>
      )}

      {isItemCompleted && (
        <div className="absolute top-2 right-2 rounded bg-green-600 px-2 py-1 text-xs text-white shadow-sm">
          Watched
        </div>
      )}
    </>
  );

  const metadataContent = (
    <>
      <h3 className="truncate text-sm leading-tight font-medium">
        {mainTitle}
      </h3>
      {subtitle && (
        <div className="text-muted-foreground text-xs leading-tight">
          {subtitle.split("\n").map((line, index) => (
            <div key={index} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2">
        <div className="group relative h-[240px] w-[160px]">
          <Link
            href={detailsHref}
            aria-label={`View details for ${mainTitle}`}
            onClick={handleAnchorClick}
            className="bg-muted relative block size-full overflow-hidden rounded-md shadow-lg transition-all duration-200 group-hover:shadow-xl active:scale-[0.98] md:active:scale-100"
          >
            {posterContent}
            <div className="absolute top-2 left-2 rounded bg-black/60 p-1 md:hidden">
              <MoreHorizontal className="h-4 w-4 text-white" />
            </div>
          </Link>

          {/* Hover Overlay with Play Button - Desktop only */}
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex">
            <Button
              variant="secondary"
              size="icon"
              className="group/button pointer-events-auto h-12 w-12 rounded-full"
              onClick={handlePlay}
              aria-label="Play"
            >
              <Play className="fill-black/60 stroke-black/60 transition-all duration-200 group-hover/button:fill-black/20 group-hover/button:stroke-black/20 dark:fill-white/60 dark:stroke-white/60 group-hover/button:dark:fill-white/20 group-hover/button:dark:stroke-white/20" />
            </Button>
          </div>
        </div>

        <Link
          href={detailsHref}
          onClick={handleAnchorClick}
          className="focus-visible:ring-ring flex w-[160px] flex-col gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          {metadataContent}
        </Link>
      </div>

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

/* ────────────────────────────────────────────────────────────
   Loading Skeleton - Updated to match actual poster dimensions
   ──────────────────────────────────────────────────────────── */

function ContinueWatchingItemSkeleton() {
  return (
    <div className="flex-shrink-0 space-y-2">
      <div className="h-[240px] w-[160px] rounded-md shadow-lg">
        <Skeleton className="h-full w-full rounded-md" />
      </div>
      <div className="w-[160px] space-y-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

"use client";

import { CirclePlay, Play } from "lucide-react";
import Image from "next/image";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type { ContinueWatchingItem } from "~/lib/plex.tv/continue-watching-schemas";
import {
  getMainTitle,
  getSubtitle,
  getThumbnailUrl,
  isCompleted,
} from "~/lib/plex.tv/continue-watching-utils";

/* ────────────────────────────────────────────────────────────
   Continue Watching Component
   Horizontal slider of poster items with progress
   ──────────────────────────────────────────────────────────── */

export interface ContinueWatchingProps {
  /** Continue Watching items to display */
  items: (ContinueWatchingItem & { serverUrl?: string; authToken?: string })[];
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Custom title for the section */
  title?: string;
  /** Whether to show loading skeletons */
  isLoading?: boolean;
  /** Error message to display */
  error?: string;
}

export function ContinueWatching({
  items,
  showTitle = true,
  title = "Continue Watching",
  isLoading = false,
  error,
}: ContinueWatchingProps) {
  if (error) {
    return (
      <div className="my-6 space-y-4">
        {showTitle && (
          <h2 className="px-8 text-2xl font-semibold tracking-tight">
            {title}
          </h2>
        )}
        <div className="text-muted-foreground px-8 text-sm">
          Failed to load Continue Watching data: {error}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="my-6 space-y-4">
        {showTitle && (
          <h2 className="px-8 text-2xl font-semibold tracking-tight">
            {title}
          </h2>
        )}
        <div className="w-full max-w-full overflow-hidden">
          <div className="scrollbar-hide flex gap-4 overflow-x-auto px-8 pb-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ContinueWatchingItemSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="my-6 space-y-4">
        {showTitle && (
          <h2 className="px-8 text-2xl font-semibold tracking-tight">
            {title}
          </h2>
        )}
        <div className="text-muted-foreground px-8 text-sm">
          Nothing to continue watching. Start watching something to see it here.
        </div>
      </div>
    );
  }

  return (
    <div className="my-6 space-y-4">
      {showTitle && (
        <div className="flex items-center justify-between px-8">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
      )}

      <div className="w-full max-w-full overflow-hidden">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto px-8 pb-4">
          {items.map((item) => (
            <ContinueWatchingItem
              key={`${item.serverId}-${item.ratingKey}`}
              item={item}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Continue Watching Item Component
   Individual poster item with metadata and progress
   ──────────────────────────────────────────────────────────── */

interface ContinueWatchingItemProps {
  item: ContinueWatchingItem & { serverUrl?: string; authToken?: string };
}

function ContinueWatchingItem({ item }: ContinueWatchingItemProps) {
  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const progressPercent = item.progressPercent ?? 0;
  const isItemCompleted = isCompleted(item);

  // Generate thumbnail URL using Plex photo transcoding service
  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const handlePlay = () => {
    // TODO: Implement play functionality
    console.log("Play item:", item);
  };

  return (
    <div className="flex-shrink-0 space-y-2">
      {/* Poster Container */}
      <div className="relative">
        {/* Poster Image */}
        <div className="bg-muted group relative h-[240px] w-[160px] overflow-hidden rounded-lg shadow-lg transition-all duration-200 group-hover:shadow-xl">
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

          {/* Progress Bar */}
          {progressPercent > 0 && (
            <div className="absolute right-0 bottom-0 left-0 h-1 bg-black/30">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
          )}

          {/* Completion Badge */}
          {isItemCompleted && (
            <div className="absolute top-2 right-2 rounded bg-green-600 px-2 py-1 text-xs text-white shadow-sm">
              Watched
            </div>
          )}

          {/* Hover Overlay with Play Button */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Button
              variant="secondary"
              size="icon"
              className="group/button h-12 w-12 cursor-pointer rounded-full"
              onClick={handlePlay}
              aria-label="Play"
            >
              <Play className="fill-white/60 stroke-white/60 transition-all duration-200 group-hover/button:fill-white/20 group-hover/button:stroke-white/20" />
            </Button>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="w-[160px] space-y-1">
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
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Loading Skeleton
   ──────────────────────────────────────────────────────────── */

function ContinueWatchingItemSkeleton() {
  return (
    <div className="flex-shrink-0 space-y-2">
      <div className="h-[300px] w-[200px] rounded-lg shadow-lg">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
      <div className="w-[200px] space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

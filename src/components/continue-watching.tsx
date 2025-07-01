"use client";

import { useAtom, useAtomValue } from "jotai";
import { CirclePlay, Play, MoreHorizontal } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import {
  openMediaPlayerAtom,
  updatedItemsProgressAtom,
} from "~/atoms/media-player";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { useIsMobile } from "~/hooks/use-mobile";
import type { ContinueWatchingItem } from "~/lib/plex.tv/schemas/continue-watching-schemas";
import {
  getMainTitle,
  getSubtitle,
  getThumbnailUrl,
  isCompleted,
} from "~/lib/plex.tv/utils/continue-watching-utils";
import { isMediaPlayerItem } from "~/types/media-player";

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
  const [, openPlayer] = useAtom(openMediaPlayerAtom);
  const updatedProgress = useAtomValue(updatedItemsProgressAtom);
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);

  // Use updated progress if available, otherwise use server data
  const progressPercent: number =
    updatedProgress[item.ratingKey] ?? item.progressPercent ?? 0;
  const isItemCompleted = isCompleted(item);

  // Generate thumbnail URL using Plex photo transcoding service
  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const handlePlay = () => {
    // Check if item has required fields for media playback
    if (!isMediaPlayerItem(item)) {
      console.error("Missing server URL or auth token for media playback");
      return;
    }

    // Open the media player with this item
    openPlayer(item);
  };

  const handleMobileTap = () => {
    if (isMobile) {
      setIsDrawerOpen(true);
    }
  };

  const handlePlayFromDrawer = () => {
    setIsDrawerOpen(false);
    handlePlay();
  };

  return (
    <>
      <div className="flex-shrink-0 space-y-2">
        {/* Poster Container */}
        <div className="relative">
          {/* Poster Image */}
          <div
            className={`bg-muted group relative h-[240px] w-[160px] overflow-hidden rounded-md shadow-lg transition-all duration-200 group-hover:shadow-xl ${
              isMobile ? "cursor-pointer" : ""
            }`}
            onClick={handleMobileTap}
          >
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
                  className={`dark:bg-primary h-full transition-all duration-300 ${
                    item.progressColor === "dark"
                      ? "bg-dark-primary"
                      : "bg-light-primary"
                  }`}
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

            {/* Hover Overlay with Play Button - Hidden on mobile */}
            <div className="absolute inset-0 hidden items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex">
              <Button
                variant="secondary"
                size="icon"
                className="group/button h-12 w-12 cursor-pointer rounded-full"
                onClick={handlePlay}
                aria-label="Play"
              >
                <Play className="fill-black/60 stroke-black/60 transition-all duration-200 group-hover/button:fill-black/20 group-hover/button:stroke-black/20 dark:fill-white/60 dark:stroke-white/60 group-hover/button:dark:fill-white/20 group-hover/button:dark:stroke-white/20" />
              </Button>
            </div>

            {/* Mobile Options Indicator - Only visible on mobile */}
            {isMobile && (
              <div className="absolute top-2 left-2 rounded bg-black/60 p-1">
                <MoreHorizontal className="h-4 w-4 text-white" />
              </div>
            )}
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

      {/* Mobile Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{mainTitle}</DrawerTitle>
            {subtitle && (
              <p className="text-muted-foreground text-sm">{subtitle}</p>
            )}
          </DrawerHeader>

          <div className="space-y-4 p-4">
            {/* Progress Info */}
            {progressPercent > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span>{Math.round(progressPercent)}%</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className={`h-full transition-all duration-300 ${
                      item.progressColor === "dark"
                        ? "bg-dark-primary"
                        : "bg-light-primary"
                    }`}
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2">
              <Button
                onClick={handlePlayFromDrawer}
                className="w-full"
                disabled={!isMediaPlayerItem(item)}
              >
                <Play className="mr-2 h-4 w-4" />
                {progressPercent > 0 ? "Continue Watching" : "Play"}
              </Button>

              {progressPercent > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    // TODO: Implement restart from beginning
                    setIsDrawerOpen(false);
                  }}
                  className="w-full"
                >
                  Restart from Beginning
                </Button>
              )}
            </div>

            {/* Additional Info */}
            <div className="text-muted-foreground space-y-2 text-sm">
              {item.year && <div>Year: {item.year}</div>}
              {item.contentRating && <div>Rating: {item.contentRating}</div>}
              {item.duration && (
                <div>
                  Duration: {Math.floor(item.duration / 1000 / 60)} minutes
                </div>
              )}
              {item.librarySectionTitle && (
                <div>Library: {item.librarySectionTitle}</div>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
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

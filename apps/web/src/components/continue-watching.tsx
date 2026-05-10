import { CirclePlay, MoreHorizontal, Play } from "lucide-react";
import React, { useState } from "react";

import { Button } from "./ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Skeleton } from "./ui/skeleton";
import { useIsMobile } from "../hooks/use-mobile";
import {
  type ContinueWatchingItemWithServer,
  getMainTitle,
  getSubtitle,
  getThumbnailUrl,
  isCompleted,
} from "@multiplex/plex-query";

/* ────────────────────────────────────────────────────────────
   Continue Watching Component
   Horizontal slider of poster items with progress
   ──────────────────────────────────────────────────────────── */

interface SectionWrapperProps {
  children: React.ReactNode;
  showTitle?: boolean;
  title?: string;
}

function SectionWrapper({ children, showTitle, title }: SectionWrapperProps) {
  return (
    <div className="flex flex-col gap-y-4">
      {showTitle && (
        <div className="flex items-center justify-between px-8">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

export interface ContinueWatchingProps {
  /** Continue Watching items */
  items: ContinueWatchingItemWithServer[];
  /** Whether the data is loading */
  isLoading?: boolean;
  /** Error if fetch failed */
  error?: Error | null;
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Custom title for the section */
  title?: string;
}

export function ContinueWatching({
  items,
  isLoading = false,
  error,
  showTitle = true,
  title = "Continue Watching",
}: ContinueWatchingProps) {
  // Show error state
  if (error && items.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="text-muted-foreground px-8 text-sm">
          Failed to load Continue Watching data
        </div>
      </SectionWrapper>
    );
  }

  // Show loading state
  if (isLoading && items.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="w-full max-w-full overflow-hidden">
          <div className="scrollbar-hide flex gap-4 overflow-x-auto px-8 pb-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ContinueWatchingItemSkeleton key={i} />
            ))}
          </div>
        </div>
      </SectionWrapper>
    );
  }

  // Show empty state
  if (items.length === 0) {
    return (
      <SectionWrapper showTitle={showTitle} title={title}>
        <div className="text-muted-foreground px-8 text-sm">
          Nothing to continue watching. Start watching something to see it here.
        </div>
      </SectionWrapper>
    );
  }

  return (
    <SectionWrapper showTitle={showTitle} title={title}>
      <div className="w-full max-w-full overflow-hidden">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto px-8 pb-4">
          {items.map((item) => (
            <ContinueWatchingItem key={`${item.serverId}-${item.ratingKey}`} item={item} />
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
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const progressPercent = item.progressPercent ?? 0;
  const isItemCompleted = isCompleted(item);

  // Generate thumbnail URL using Plex photo transcoding service
  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const handlePlay = () => {
    // TODO: Implement media player in Phase 5
    console.log("Play item:", item.ratingKey);
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

  const handleRestartFromBeginning = () => {
    // TODO: Implement restart in Phase 5
    console.log("Restart from beginning:", item.ratingKey);
    setIsDrawerOpen(false);
  };

  return (
    <>
      <div className="flex-shrink-0 space-y-2">
        {/* Poster Container */}
        <div className="relative">
          {/* Poster Image */}
          <div
            className={`bg-muted group relative h-[240px] w-[160px] overflow-hidden rounded-md shadow-lg transition-all duration-200 hover:shadow-xl ${
              isMobile ? "cursor-pointer" : ""
            }`}
            onClick={handleMobileTap}
          >
            {thumbnailUrl ? (
              <img
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
          <h3 className="truncate text-sm leading-tight font-medium">{mainTitle}</h3>

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
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
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
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2">
              <Button onClick={handlePlayFromDrawer} className="w-full">
                <Play className="mr-2 h-4 w-4" />
                {progressPercent > 0 ? "Continue Watching" : "Play"}
              </Button>

              {progressPercent > 0 && (
                <Button variant="outline" onClick={handleRestartFromBeginning} className="w-full">
                  Restart from Beginning
                </Button>
              )}
            </div>

            {/* Additional Info */}
            <div className="text-muted-foreground space-y-2 text-sm">
              {item.year && <div>Year: {item.year}</div>}
              {item.contentRating && <div>Rating: {item.contentRating}</div>}
              {item.duration && (
                <div>Duration: {Math.floor(item.duration / 1000 / 60)} minutes</div>
              )}
              {item.librarySectionTitle && <div>Library: {item.librarySectionTitle}</div>}
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

"use client";

import {
  formatLastViewedLabel,
  formatSeasonEpisodeLabel,
  formatTimeRemaining,
  getContinueWatchingDetailChips,
  getContinueWatchingEpisodeTitle,
  getMainTitle,
  getSubtitle,
  type ContinueWatchingItemWithServer,
} from "@multiplex/plex-query";
import { ChevronRight, CirclePlay, Play, RotateCcw } from "lucide-react";
import Image from "next/image";

import { MediaProgressBar } from "~/components/media-progress-bar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "~/components/ui/drawer";

interface ContinueWatchingDrawerProps {
  item: ContinueWatchingItemWithServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progressPercent: number;
  thumbnailUrl?: string;
  canPlay: boolean;
  onPlay: () => void;
  onRestart: () => void;
  onViewDetails: () => void;
}

export function ContinueWatchingDrawer({
  item,
  open,
  onOpenChange,
  progressPercent,
  thumbnailUrl,
  canPlay,
  onPlay,
  onRestart,
  onViewDetails,
}: ContinueWatchingDrawerProps) {
  const mainTitle = getMainTitle(item);
  const subtitle = getSubtitle(item);
  const episodeTitle = getContinueWatchingEpisodeTitle(item);
  const detailChips = getContinueWatchingDetailChips(item);
  const timeRemainingLabel = formatTimeRemaining(item.timeRemaining);
  const lastViewedLabel = formatLastViewedLabel(item.lastViewedAt);
  const hasProgress = progressPercent > 0;
  const seasonEpisodeLabel =
    item.type === "episode"
      ? formatSeasonEpisodeLabel(item.parentIndex, item.index)
      : undefined;
  const secondaryLine =
    item.type === "episode" ? seasonEpisodeLabel : subtitle || undefined;
  const footerLabel = [item.librarySectionTitle, item.serverName]
    .filter(Boolean)
    .join(" · ");

  return (
    <Drawer open={open} onOpenChange={onOpenChange} modal>
      <DrawerContent className="max-h-[min(88vh,720px)]">
        <DrawerTitle className="sr-only">{mainTitle}</DrawerTitle>
        <DrawerDescription className="sr-only">
          Continue watching options for {mainTitle}
        </DrawerDescription>

        <div className="flex flex-col gap-5 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <div className="flex gap-4">
            <div className="bg-muted ring-border/60 relative h-[108px] w-[72px] shrink-0 overflow-hidden rounded-lg shadow-md ring-1">
              {thumbnailUrl ? (
                <Image
                  src={thumbnailUrl}
                  alt=""
                  fill
                  sizes="72px"
                  className="object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <CirclePlay className="text-muted-foreground size-8" />
                </div>
              )}
              {hasProgress && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-black/60 to-transparent" />
                  <MediaProgressBar
                    value={progressPercent}
                    className="absolute right-0 bottom-0 left-0 h-1 bg-black/40"
                    fillClassName="bg-primary"
                  />
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {detailChips.map((chip) => (
                  <Badge
                    key={chip}
                    variant="secondary"
                    className="text-[11px] font-normal"
                  >
                    {chip}
                  </Badge>
                ))}
              </div>
              <h2 className="text-foreground text-lg leading-tight font-semibold tracking-tight">
                {mainTitle}
              </h2>
              {episodeTitle && item.type === "episode" && (
                <p className="text-foreground/80 line-clamp-2 text-sm leading-5">
                  {episodeTitle}
                </p>
              )}
              {secondaryLine && (
                <p className="text-muted-foreground text-sm leading-5">
                  {secondaryLine}
                </p>
              )}
              {lastViewedLabel && (
                <p className="text-muted-foreground text-xs">
                  {lastViewedLabel}
                </p>
              )}
            </div>
          </div>

          {hasProgress && (
            <div className="bg-muted/60 ring-border/50 rounded-xl p-3 ring-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-foreground text-sm font-medium">
                  {timeRemainingLabel || "In progress"}
                </span>
                <span className="text-muted-foreground text-sm">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              <MediaProgressBar
                value={progressPercent}
                className="bg-background/80 h-2 overflow-hidden rounded-full"
                fillClassName="bg-primary transition-all duration-300"
              />
            </div>
          )}

          {item.summary && (
            <p className="text-foreground/80 line-clamp-3 text-sm leading-6">
              {item.summary}
            </p>
          )}

          <div className="flex flex-col gap-2.5">
            <Button
              onClick={onPlay}
              className="min-h-11 w-full"
              disabled={!canPlay}
            >
              <Play data-icon="inline-start" />
              {hasProgress ? "Continue Watching" : "Play"}
            </Button>

            <div
              className={
                hasProgress ? "grid grid-cols-2 gap-2.5" : "grid grid-cols-1"
              }
            >
              {hasProgress && (
                <Button
                  variant="outline"
                  onClick={onRestart}
                  className="min-h-11"
                  disabled={!canPlay}
                >
                  <RotateCcw data-icon="inline-start" />
                  Restart
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onViewDetails}
                className="min-h-11"
              >
                Details
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>

          {footerLabel && (
            <p className="text-muted-foreground text-center text-xs">
              {footerLabel}
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

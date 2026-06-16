"use client";

import { CirclePlay, MoreHorizontal, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  getHubItemSubtitle,
  getHubItemTitle,
  getThumbnailUrl,
  type HubItemWithServer,
} from "@multiplex/plex-query";
import { MediaProgressBar } from "~/components/media-progress-bar";
import { Button } from "~/components/ui/button";
import { getHubItemHref } from "~/lib/plex-routes";
import { cn } from "~/lib/utils";

const POSTER_SIZE_CLASSNAME = "h-[240px] w-[160px]";

interface MediaPosterCardContentProps {
  title: string;
  subtitle?: string;
  detailsHref: string;
  thumbnailUrl?: string | null;
  className?: string;
  progressPercent?: number;
  isCompleted?: boolean;
  showPlayOverlay?: boolean;
  onPlay?: () => void;
  onNavigateClick?: (event: React.MouseEvent) => void;
  showMobileMenuHint?: boolean;
}

interface MediaPosterCardFromItemProps
  extends Omit<
    MediaPosterCardContentProps,
    "title" | "subtitle" | "detailsHref" | "thumbnailUrl"
  > {
  item: HubItemWithServer;
}

export type MediaPosterCardProps =
  | MediaPosterCardContentProps
  | MediaPosterCardFromItemProps;

function isItemProps(
  props: MediaPosterCardProps,
): props is MediaPosterCardFromItemProps {
  return "item" in props;
}

function resolvePosterCardContent(
  props: MediaPosterCardProps,
): MediaPosterCardContentProps {
  if (!isItemProps(props)) {
    return props;
  }

  const { item, ...rest } = props;
  return {
    ...rest,
    title: getHubItemTitle(item),
    subtitle: getHubItemSubtitle(item),
    detailsHref: getHubItemHref(item.serverId, item),
    thumbnailUrl: getThumbnailUrl(item, item.serverUrl, item.authToken),
  };
}

export function MediaPosterCard(props: MediaPosterCardProps) {
  const {
    title,
    subtitle,
    detailsHref,
    thumbnailUrl,
    className,
    progressPercent = 0,
    isCompleted = false,
    showPlayOverlay = false,
    onPlay,
    onNavigateClick,
    showMobileMenuHint = false,
  } = resolvePosterCardContent(props);

  const [imageFailed, setImageFailed] = useState(false);

  const posterContent = (
    <>
      {thumbnailUrl && !imageFailed ? (
        <Image
          src={thumbnailUrl}
          alt={title}
          className="h-full w-full object-cover"
          loading="lazy"
          width={160}
          height={240}
          onError={() => setImageFailed(true)}
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

      {isCompleted && (
        <div className="absolute top-2 right-2 rounded bg-green-600 px-2 py-1 text-xs text-white shadow-sm">
          Watched
        </div>
      )}
    </>
  );

  const metadataContent = (
    <>
      <h3 className="truncate text-sm leading-tight font-medium">{title}</h3>
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
    <div className={cn("flex shrink-0 flex-col gap-2", className)}>
      <div className={cn("group relative", POSTER_SIZE_CLASSNAME)}>
        <Link
          href={detailsHref}
          aria-label={`View details for ${title}`}
          onClick={onNavigateClick}
          className="bg-muted relative block size-full overflow-hidden rounded-md shadow-lg transition-[transform,box-shadow] duration-200 ease-out group-hover:shadow-xl active:scale-[0.98] md:active:scale-100"
        >
          {posterContent}
          {showMobileMenuHint && (
            <div className="absolute top-2 left-2 rounded bg-black/60 p-1 md:hidden">
              <MoreHorizontal className="h-4 w-4 text-white" />
            </div>
          )}
        </Link>

        {showPlayOverlay && onPlay && (
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex">
            <Button
              variant="secondary"
              size="icon"
              className="group/button pointer-events-auto h-12 w-12 rounded-full"
              onClick={onPlay}
              aria-label="Play"
            >
              <Play className="fill-black/60 stroke-black/60 transition-colors duration-200 ease-out group-hover/button:fill-black/20 group-hover/button:stroke-black/20 dark:fill-white/60 dark:stroke-white/60 group-hover/button:dark:fill-white/20 group-hover/button:dark:stroke-white/20" />
            </Button>
          </div>
        )}
      </div>

      <Link
        href={detailsHref}
        onClick={onNavigateClick}
        className="focus-visible:ring-ring flex w-[160px] flex-col gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        {metadataContent}
      </Link>
    </div>
  );
}

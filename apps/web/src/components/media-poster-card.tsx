"use client";

import { CirclePlay } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  getHubItemSubtitle,
  getHubItemTitle,
  getThumbnailUrl,
  type HubItemWithServer,
} from "@multiplex/plex-query";
import {
  POSTER_CARD_CONTAINER_CLASSNAME,
  POSTER_HEIGHT_CLASSNAME,
  POSTER_METADATA_WIDTH_CLASSNAME,
  POSTER_WIDTH_CLASSNAME,
} from "~/lib/poster-grid-layout";
import { getHubItemHref } from "~/lib/plex-routes";
import { cn } from "~/lib/utils";

interface MediaPosterCardProps {
  item: HubItemWithServer;
  className?: string;
}

export function MediaPosterCard({ item, className }: MediaPosterCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = getHubItemTitle(item);
  const subtitle = getHubItemSubtitle(item);
  const detailsHref = getHubItemHref(item.serverId, item);
  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const posterClassName = cn(
    "bg-muted group relative block overflow-hidden rounded-md shadow-lg transition-all duration-200 hover:shadow-xl active:scale-[0.98]",
    POSTER_HEIGHT_CLASSNAME,
    POSTER_WIDTH_CLASSNAME,
  );

  const metadataClassName = cn(
    "focus-visible:ring-ring rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none",
    POSTER_METADATA_WIDTH_CLASSNAME,
  );

  return (
    <div className={cn(POSTER_CARD_CONTAINER_CLASSNAME, className)}>
      <Link
        href={detailsHref}
        aria-label={`View details for ${title}`}
        className={posterClassName}
      >
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
            <CirclePlay className="text-muted-foreground h-10 w-10 sm:h-12 sm:w-12" />
          </div>
        )}
      </Link>

      <Link href={detailsHref} className={metadataClassName}>
        <h3 className="truncate text-sm leading-tight font-medium">{title}</h3>
        {subtitle && (
          <p className="text-muted-foreground truncate text-xs leading-tight">
            {subtitle}
          </p>
        )}
      </Link>
    </div>
  );
}

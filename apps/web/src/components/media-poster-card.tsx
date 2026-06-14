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
import { getHubItemHref } from "~/lib/plex-routes";

interface MediaPosterCardProps {
  item: HubItemWithServer;
  className?: string;
  layout?: "row" | "grid";
}

export function MediaPosterCard({
  item,
  className,
  layout = "row",
}: MediaPosterCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = getHubItemTitle(item);
  const subtitle = getHubItemSubtitle(item);
  const detailsHref = getHubItemHref(item.serverId, item);
  const thumbnailUrl = getThumbnailUrl(item, item.serverUrl, item.authToken);

  const posterClassName =
    layout === "grid"
      ? "bg-muted group relative block h-[180px] w-[120px] overflow-hidden rounded-md shadow-lg transition-all duration-200 hover:shadow-xl active:scale-[0.98] sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]"
      : "bg-muted group relative block h-[180px] w-[120px] overflow-hidden rounded-md shadow-lg transition-all duration-200 hover:shadow-xl active:scale-[0.98] sm:h-[210px] sm:w-[140px] md:h-[240px] md:w-[160px]";

  const metadataClassName =
    layout === "grid"
      ? "focus-visible:ring-ring w-[120px] rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none sm:w-[140px] md:w-[160px]"
      : "focus-visible:ring-ring w-[120px] rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none sm:w-[140px] md:w-[160px]";

  const containerClassName = `flex shrink-0 flex-col gap-2 ${className ?? ""}`;

  return (
    <div className={containerClassName}>
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

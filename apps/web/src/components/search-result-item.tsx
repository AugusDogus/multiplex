"use client";

import Image from "next/image";
import {
  getMetadataTypeLabel,
  getPosterImagePath,
  type ProcessedSearchResult,
} from "@multiplex/plex-query";
import { getPlexImagePath } from "~/lib/plex-image";

export function SearchResultItem({
  result,
}: {
  result: ProcessedSearchResult;
}) {
  const thumbnailUrl = getPlexImagePath(
    getPosterImagePath({ type: result.type, thumb: result.thumb }),
    {
      width: 80,
      height: 80,
      serverUrl: result.serverUrl,
      authToken: result.authToken,
    },
  );
  const parentTitle =
    result.type === "episode"
      ? result.grandparentTitle
      : result.type === "track" || result.type === "album"
        ? result.artistName
        : undefined;
  const episode =
    result.type === "episode" &&
    result.seasonNumber !== undefined &&
    result.seasonNumber !== null &&
    result.episodeNumber !== undefined &&
    result.episodeNumber !== null
      ? `S${result.seasonNumber.toString().padStart(2, "0")}E${result.episodeNumber.toString().padStart(2, "0")}`
      : undefined;
  const metadata = [
    parentTitle,
    episode,
    result.year,
    getMetadataTypeLabel(result.type),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div className="bg-muted relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            className="object-cover"
            fill
            sizes="32px"
          />
        ) : (
          <span className="text-icon-muted text-xs">
            {getMetadataTypeLabel(result.type).charAt(0)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{result.title}</div>
        <div className="text-secondary-label truncate text-xs">{metadata}</div>
      </div>
      <span
        className="text-secondary-label hidden max-w-24 truncate text-xs sm:block"
        title={result.serverName}
      >
        {result.serverName}
      </span>
    </div>
  );
}

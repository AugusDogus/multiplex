"use client";

import Image from "next/image";
import Link from "next/link";
import { Play } from "lucide-react";
import {
  formatEpisodeCount,
  getPlexImageUrl,
  getSeasonPosterImagePath,
  getWatchedPercent,
} from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";
import { getItemDetailsHref } from "~/lib/plex-routes";

import { DetailsSection } from "./details-section";
import type { EnrichedChildMetadata, MediaServerContext } from "./types";

interface SeasonGridProps extends MediaServerContext {
  seasons: EnrichedChildMetadata[];
}

export function SeasonGrid({
  seasons,
  serverId,
  serverUrl,
  authToken,
}: SeasonGridProps) {
  return (
    <DetailsSection title="Seasons" bleed>
      <div className="relative">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 pb-2 sm:px-0">
          {seasons.map((season) => (
            <SeasonCard
              key={season.ratingKey}
              season={season}
              serverId={serverId}
              serverUrl={serverUrl}
              authToken={authToken}
            />
          ))}
        </div>
        <div
          aria-hidden
          className="from-background via-background/80 pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l to-transparent sm:hidden"
        />
      </div>
    </DetailsSection>
  );
}

interface SeasonCardProps extends MediaServerContext {
  season: EnrichedChildMetadata;
}

function SeasonCard({
  season,
  serverId,
  serverUrl,
  authToken,
}: SeasonCardProps) {
  const posterUrl = getPlexImageUrl(
    getSeasonPosterImagePath(season),
    serverUrl,
    authToken,
    {
      width: 300,
      height: 450,
    },
  );
  const watchedPercent = getWatchedPercent(season);

  return (
    <Link
      href={getItemDetailsHref(serverId, season.ratingKey)}
      className="focus-visible:ring-ring group flex w-32 shrink-0 flex-col gap-2 rounded-xl focus-visible:ring-2 focus-visible:outline-none sm:w-40 sm:gap-3"
    >
      <div className="bg-muted ring-border relative aspect-2/3 overflow-hidden rounded-xl shadow-lg ring-1 transition-shadow group-hover:shadow-xl">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt={`${season.title} poster`}
            fill
            sizes="160px"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Play className="text-muted-foreground size-10" />
          </div>
        )}
        {season.leafCount && (
          <Badge className="absolute top-2 right-2 shadow-sm">
            {season.leafCount}
          </Badge>
        )}
        {watchedPercent > 0 && (
          <div className="absolute right-0 bottom-0 left-0 h-1 bg-black/40">
            <div
              className="bg-primary h-full"
              style={{ width: `${watchedPercent}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="line-clamp-2 text-sm leading-5 font-medium">
          {season.title}
        </h3>
        <p className="text-muted-foreground text-xs">
          {formatEpisodeCount(season.leafCount)}
        </p>
      </div>
    </Link>
  );
}

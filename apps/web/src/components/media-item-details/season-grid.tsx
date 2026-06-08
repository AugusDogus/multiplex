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
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Seasons</h2>
      <div className="scrollbar-hide flex gap-4 overflow-x-auto pb-2">
        {seasons.map((season) => {
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
              key={season.ratingKey}
              href={getItemDetailsHref(serverId, season.ratingKey)}
              className="focus-visible:ring-ring group flex w-40 shrink-0 flex-col gap-3 rounded-xl focus-visible:ring-2 focus-visible:outline-none"
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
        })}
      </div>
    </section>
  );
}

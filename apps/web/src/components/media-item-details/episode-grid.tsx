"use client";

import Image from "next/image";
import Link from "next/link";
import { Play } from "lucide-react";
import {
  formatEpisodeCount,
  formatEpisodeListLabel,
  getPlexImageUrl,
  getProgressPercent,
} from "@multiplex/plex-query";

import { Button } from "~/components/ui/button";
import { getItemDetailsHref } from "~/lib/plex-routes";

import type {
  EnrichedChildMetadata,
  MediaServerContext,
  PlayableChildMetadata,
} from "./types";

interface EpisodeGridProps extends MediaServerContext {
  episodes: EnrichedChildMetadata[];
  playableByRatingKey: Map<string, PlayableChildMetadata>;
  onPlay: (episode: PlayableChildMetadata) => void;
}

export function EpisodeGrid({
  episodes,
  playableByRatingKey,
  serverId,
  serverUrl,
  authToken,
  onPlay,
}: EpisodeGridProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">
        {formatEpisodeCount(episodes.length)}
      </h2>

      <div className="flex flex-col gap-3 sm:hidden">
        {episodes.map((episode) => (
          <MobileEpisodeRow
            key={episode.ratingKey}
            episode={episode}
            playable={playableByRatingKey.get(episode.ratingKey)}
            serverId={serverId}
            serverUrl={serverUrl}
            authToken={authToken}
            onPlay={onPlay}
          />
        ))}
      </div>

      <div className="hidden gap-5 sm:grid sm:grid-cols-2 xl:grid-cols-3">
        {episodes.map((episode) => (
          <EpisodeCard
            key={episode.ratingKey}
            episode={episode}
            playable={playableByRatingKey.get(episode.ratingKey)}
            serverId={serverId}
            serverUrl={serverUrl}
            authToken={authToken}
            onPlay={onPlay}
          />
        ))}
      </div>
    </section>
  );
}

interface EpisodeCardProps extends MediaServerContext {
  episode: EnrichedChildMetadata;
  playable: PlayableChildMetadata | undefined;
  onPlay: (episode: PlayableChildMetadata) => void;
}

function MobileEpisodeRow({
  episode,
  playable,
  serverId,
  serverUrl,
  authToken,
  onPlay,
}: EpisodeCardProps) {
  const thumbnailUrl = getPlexImageUrl(episode.thumb, serverUrl, authToken, {
    width: 320,
    height: 180,
  });
  const progressPercent = getProgressPercent(episode);
  const detailsHref = getItemDetailsHref(serverId, episode.ratingKey);
  const displayTitle = getEpisodeDisplayTitle(episode);

  return (
    <article className="flex gap-3">
      <div className="relative w-[132px] shrink-0">
        <Link
          href={detailsHref}
          aria-label={`View details for ${displayTitle}`}
          className="bg-muted relative block aspect-video overflow-hidden rounded-lg shadow-md"
        >
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={`${displayTitle} thumbnail`}
              fill
              sizes="132px"
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Play className="text-muted-foreground size-8" />
            </div>
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent" />
          {progressPercent > 0 && (
            <div className="absolute right-0 bottom-0 left-0 h-1 bg-black/40">
              <div
                className="bg-primary h-full"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
          )}
        </Link>
        {playable && (
          <Button
            type="button"
            size="icon"
            className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg"
            onClick={() => onPlay(playable)}
            aria-label={`Play ${displayTitle}`}
          >
            <Play className="fill-current" />
          </Button>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5">
        <Link
          href={detailsHref}
          className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <h3 className="line-clamp-2 text-sm leading-5 font-medium">
            {displayTitle}
          </h3>
        </Link>
        <p className="text-muted-foreground text-xs">
          {formatEpisodeListLabel(episode)}
        </p>
        {episode.summary && (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
            {episode.summary}
          </p>
        )}
      </div>
    </article>
  );
}

function EpisodeCard({
  episode,
  playable,
  serverId,
  serverUrl,
  authToken,
  onPlay,
}: EpisodeCardProps) {
  const thumbnailUrl = getPlexImageUrl(episode.thumb, serverUrl, authToken, {
    width: 480,
    height: 270,
  });
  const progressPercent = getProgressPercent(episode);
  const detailsHref = getItemDetailsHref(serverId, episode.ratingKey);

  return (
    <article className="group flex min-w-0 flex-col gap-3">
      <div className="relative aspect-video overflow-hidden rounded-xl shadow-lg">
        <Link
          href={detailsHref}
          aria-label={`View details for ${episode.title}`}
          className="bg-muted block size-full"
        >
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={`${episode.title} thumbnail`}
              fill
              sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 90vw"
              className="object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Play className="text-muted-foreground size-10" />
            </div>
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-80" />
          {progressPercent > 0 && (
            <div className="absolute right-0 bottom-0 left-0 h-1 bg-black/40">
              <div
                className="bg-primary h-full"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
          )}
        </Link>
        {playable && (
          <Button
            type="button"
            size="icon"
            className="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => onPlay(playable)}
            aria-label={`Play ${episode.title}`}
          >
            <Play className="fill-current" />
          </Button>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          href={detailsHref}
          className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <h3 className="line-clamp-2 text-sm leading-5 font-medium">
            {episode.title}
          </h3>
        </Link>
        <p className="text-muted-foreground text-xs">
          {formatEpisodeListLabel(episode)}
        </p>
        {episode.summary && (
          <p className="text-muted-foreground line-clamp-3 text-sm leading-6">
            {episode.summary}
          </p>
        )}
      </div>
    </article>
  );
}

function getEpisodeDisplayTitle(episode: EnrichedChildMetadata): string {
  const title = episode.title.trim();
  const looksLikeFilename =
    /\.(mkv|mp4|avi|m4v)\b/i.test(title) ||
    /\b(1080p|720p|2160p|4k)\b/i.test(title) ||
    /\bS\d{1,2}E\d{1,2}\b/i.test(title);

  if (looksLikeFilename && episode.index) {
    return `Episode ${episode.index}`;
  }

  return title;
}

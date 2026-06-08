"use client";

import Image from "next/image";
import { Check, MoreHorizontal, Play, Share2 } from "lucide-react";
import {
  formatDetailsTimeRemaining,
  getBackdropImagePath,
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataTypeLabel,
  getPlayButtonLabel,
  getPosterImagePath,
  getPlexImageUrl,
  type PlayableMetadata,
} from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

import { MetadataDirectors } from "./metadata-directors";
import { MetadataGenres } from "./metadata-genres";
import { MetadataRating } from "./metadata-rating";
import { MetadataSummaryRow } from "./metadata-summary-row";
import type { ItemDetails, PlayTarget } from "./types";

interface DetailsHeroProps {
  item: ItemDetails["item"];
  serverId: string;
  serverName: string | null | undefined;
  serverUrl: string | null | undefined;
  authToken: string | null | undefined;
  playTarget: PlayTarget;
  onPlay: (source: PlayableMetadata) => void;
}

export function DetailsHero({
  item,
  serverId,
  serverName,
  serverUrl,
  authToken,
  playTarget,
  onPlay,
}: DetailsHeroProps) {
  const imageServerUrl = serverUrl ?? undefined;
  const imageAuthToken = authToken ?? undefined;
  const posterUrl = getPlexImageUrl(
    getPosterImagePath(item),
    imageServerUrl,
    imageAuthToken,
    { width: 440, height: 660 },
  );
  const backdropUrl = getPlexImageUrl(
    getBackdropImagePath(item),
    imageServerUrl,
    imageAuthToken,
    { width: 1280, height: 720 },
  );
  const timeRemaining = formatDetailsTimeRemaining(item);
  const secondaryTitle = getDetailsSecondaryTitle(item);
  const canPlay = Boolean(imageServerUrl && imageAuthToken && playTarget);
  const playLabel = getPlayButtonLabel(playTarget);

  return (
    <section className="relative overflow-hidden rounded-2xl border-transparent mask-[linear-gradient(#000_0_0)] [-webkit-mask:linear-gradient(#000_0_0)]">
      {backdropUrl && (
        <Image
          src={backdropUrl}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 1200px, 100vw"
          className="-z-20 object-cover"
        />
      )}
      <div className="from-background via-background/95 to-background/50 absolute inset-0 -z-10 bg-linear-to-b md:bg-linear-to-r" />
      <div className="from-background/80 absolute inset-x-0 top-0 -z-10 h-24 bg-linear-to-b to-transparent md:hidden" />

      <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-x-4 gap-y-4 p-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-5 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 lg:p-8">
        <div className="flex flex-col gap-2 self-start">
          <div className="bg-muted ring-border relative aspect-2/3 overflow-hidden rounded-lg shadow-xl ring-1 sm:rounded-xl">
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={`${item.title} poster`}
                fill
                priority
                sizes="(min-width: 1024px) 220px, 108px"
                className="object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Play className="text-muted-foreground size-10" />
              </div>
            )}
          </div>
          {timeRemaining && (
            <div className="bg-primary/10 text-primary rounded-md px-2 py-1.5 text-center text-xs font-semibold sm:text-sm">
              {timeRemaining}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-2 self-center sm:gap-3">
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <Badge variant="secondary">{getMetadataTypeLabel(item.type)}</Badge>
            <Badge variant="outline" className="max-w-full truncate">
              {item.librarySectionTitle}
            </Badge>
            <Badge variant="outline" className="max-w-full truncate">
              {serverName ?? "Plex server"}
            </Badge>
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-3xl lg:text-5xl">
            {getMainTitle(item)}
          </h1>
          {secondaryTitle && (
            <p className="text-muted-foreground text-base sm:text-xl lg:text-2xl">
              {secondaryTitle}
            </p>
          )}
          <MetadataDirectors item={item} />
          <MetadataSummaryRow item={item} serverId={serverId} />
          <MetadataGenres item={item} />
          <MetadataRating item={item} />
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:col-start-2">
          <Button
            size="lg"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={() => playTarget && onPlay(playTarget)}
            disabled={!canPlay}
          >
            <Play data-icon="inline-start" />
            {playLabel}
          </Button>
          <Button variant="outline" size="icon" aria-label="Mark as watched">
            <Check />
          </Button>
          <Button variant="outline" size="icon" aria-label="Share">
            <Share2 />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled>Watch Together...</DropdownMenuItem>
                <DropdownMenuItem disabled>Play Next</DropdownMenuItem>
                <DropdownMenuItem disabled>Add to Queue</DropdownMenuItem>
                <DropdownMenuItem disabled>Add to...</DropdownMenuItem>
                <DropdownMenuItem disabled>Report Issue...</DropdownMenuItem>
                <DropdownMenuItem disabled>Get Info</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {item.summary && (
          <p className="text-muted-foreground col-span-2 line-clamp-4 text-sm leading-relaxed sm:line-clamp-none sm:text-base lg:col-span-1 lg:col-start-2">
            {item.summary}
          </p>
        )}
      </div>
    </section>
  );
}

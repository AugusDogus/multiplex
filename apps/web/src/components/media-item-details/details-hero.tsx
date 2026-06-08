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
    <section className="relative rounded-2xl border-transparent mask-[linear-gradient(#000_0_0)] [-webkit-mask:linear-gradient(#000_0_0)]">
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
      <div className="from-background via-background/90 to-background/40 absolute inset-0 -z-10 bg-linear-to-r" />
      <div className="from-background via-background/30 absolute inset-0 -z-10 bg-linear-to-t to-transparent" />

      <div className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-6 lg:flex-row lg:p-8">
        <div className="mx-auto flex w-[140px] shrink-0 flex-col gap-3 sm:mx-0 sm:w-[180px] lg:w-[220px]">
          <div className="bg-muted ring-border relative aspect-2/3 rounded-xl mask-[linear-gradient(#000_0_0)] shadow-2xl ring-1 [-webkit-mask:linear-gradient(#000_0_0)]">
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={`${item.title} poster`}
                fill
                priority
                sizes="220px"
                className="object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Play className="text-muted-foreground size-12" />
              </div>
            )}
          </div>
          {timeRemaining && (
            <div className="bg-muted rounded-md px-3 py-2 text-center text-sm font-medium">
              {timeRemaining}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-start gap-4 sm:gap-5 lg:max-w-3xl">
          <div className="flex flex-col gap-2 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge variant="secondary">
                {getMetadataTypeLabel(item.type)}
              </Badge>
              <Badge variant="outline" className="max-w-full truncate">
                {item.librarySectionTitle}
              </Badge>
              <Badge
                variant="outline"
                className="hidden max-w-full truncate sm:inline-flex"
              >
                {serverName ?? "Plex server"}
              </Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              {getMainTitle(item)}
            </h1>
            {secondaryTitle && (
              <p className="text-muted-foreground text-lg sm:text-xl lg:text-2xl">
                {secondaryTitle}
              </p>
            )}
            <MetadataDirectors item={item} />
            <MetadataSummaryRow item={item} serverId={serverId} />
            <MetadataGenres item={item} />
            <MetadataRating item={item} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <Button
              size="lg"
              className="min-w-[140px] flex-1 sm:flex-none"
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
                  <DropdownMenuItem disabled>
                    Watch Together...
                  </DropdownMenuItem>
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
            <p className="text-muted-foreground max-w-3xl text-left text-sm leading-6 sm:text-base">
              {item.summary}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

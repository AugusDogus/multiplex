"use client";

import Image from "next/image";
import Link from "next/link";
import { Check, MoreHorizontal, Play, Share2, Star } from "lucide-react";
import {
  formatDetailsTimeRemaining,
  getBackdropImagePath,
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataSummaryLines,
  getMetadataTypeLabel,
  getPosterImagePath,
  getPlexImageUrl,
  getProgressPercent,
  getRatingLabel,
  getTechnicalRows,
  type PlayableMetadata,
} from "@multiplex/plex-query";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { useMediaPlayerStore } from "~/stores/media-player-store";

import { EpisodeGrid } from "./episode-grid";
import { SeasonGrid } from "./season-grid";
import type { MediaItemDetailsProps } from "./types";

export function MediaItemDetails({ details, serverId }: MediaItemDetailsProps) {
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const {
    item,
    children,
    playableChildren,
    playTarget,
    serverUrl,
    authToken,
    serverName,
  } = details;
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
  const directorNames = item.Director?.map((director) => director.tag) ?? [];
  const genres = item.Genre?.slice(0, 3).map((genre) => genre.tag) ?? [];
  const ratingLabel = getRatingLabel(item);
  const metadata = getMetadataSummaryLines(item);
  const technicalRows = getTechnicalRows(item);
  const secondaryTitle = getDetailsSecondaryTitle(item);
  const canPlay = Boolean(imageServerUrl && imageAuthToken && playTarget);
  const playLabel =
    playTarget && getProgressPercent(playTarget) > 0 ? "Resume" : "Play";
  const playableByRatingKey = new Map(
    playableChildren.map((episode) => [episode.ratingKey, episode]),
  );

  const openForPlayback = (source: PlayableMetadata) => {
    if (!imageServerUrl || !imageAuthToken) {
      return;
    }

    openPlayer(
      createMediaPlayerItem(source, {
        serverId,
        serverUrl: imageServerUrl,
        authToken: imageAuthToken,
      }),
    );
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-8 pb-24 md:pb-8">
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

        <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:p-8">
          <div className="flex w-full flex-col gap-3 sm:w-[220px] lg:shrink-0">
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

          <div className="flex min-w-0 flex-1 flex-col justify-start gap-5 lg:max-w-3xl">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {getMetadataTypeLabel(item.type)}
                </Badge>
                <Badge variant="outline">{item.librarySectionTitle}</Badge>
                <Badge variant="outline">{serverName ?? "Plex server"}</Badge>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                {getMainTitle(item)}
              </h1>
              {secondaryTitle && (
                <p className="text-muted-foreground text-xl sm:text-2xl">
                  {secondaryTitle}
                </p>
              )}
              {directorNames.length > 0 && (
                <p className="text-muted-foreground">
                  Directed by {directorNames.join(", ")}
                </p>
              )}
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                {metadata.map((value) => (
                  <span key={value}>{value}</span>
                ))}
                {item.type === "episode" && item.parentIndex && item.index && (
                  <span>
                    {item.parentRatingKey ? (
                      <Link
                        href={getItemDetailsHref(
                          serverId,
                          item.parentRatingKey,
                        )}
                        className="hover:text-foreground transition-colors"
                      >
                        S{item.parentIndex}
                      </Link>
                    ) : (
                      <>S{item.parentIndex}</>
                    )}{" "}
                    E{item.index}
                  </span>
                )}
              </div>
              {genres.length > 0 && (
                <p className="text-muted-foreground text-sm">
                  {genres.join(", ")}
                  {(item.Genre?.length ?? 0) > genres.length
                    ? ", and more"
                    : ""}
                </p>
              )}
              {ratingLabel && (
                <div className="flex items-center gap-2 text-sm">
                  <Star className="fill-primary text-primary size-4" />
                  <span>{ratingLabel}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="lg"
                onClick={() => playTarget && openForPlayback(playTarget)}
                disabled={!canPlay}
              >
                <Play data-icon="inline-start" />
                {playLabel}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Mark as watched"
              >
                <Check />
              </Button>
              <Button variant="outline" size="icon" aria-label="Share">
                <Share2 />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="More actions"
                  >
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
                    <DropdownMenuItem disabled>
                      Report Issue...
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>Get Info</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {item.summary && (
              <p className="text-muted-foreground max-w-3xl text-sm leading-6 sm:text-base">
                {item.summary}
              </p>
            )}
          </div>
        </div>
      </section>

      {technicalRows.length > 0 && (
        <section className="bg-card grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3">
          {technicalRows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium">{row.value}</span>
            </div>
          ))}
        </section>
      )}

      {item.type === "show" && children.length > 0 && (
        <SeasonGrid
          seasons={children}
          serverId={serverId}
          serverUrl={imageServerUrl}
          authToken={imageAuthToken}
        />
      )}

      {item.type === "season" && children.length > 0 && (
        <EpisodeGrid
          episodes={children}
          playableByRatingKey={playableByRatingKey}
          serverId={serverId}
          serverUrl={imageServerUrl}
          authToken={imageAuthToken}
          onPlay={openForPlayback}
        />
      )}

      {item.Role && item.Role.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Cast & Crew
            </h2>
          </div>
          <div className="scrollbar-hide flex gap-4 overflow-x-auto pb-2">
            {item.Role.slice(0, 18).map((role) => {
              const imageUrl = getPlexImageUrl(
                role.thumb,
                imageServerUrl,
                imageAuthToken,
                {
                  width: 160,
                  height: 160,
                },
              );

              return (
                <div
                  key={`${role.tag}-${role.role ?? "role"}`}
                  className="flex w-32 shrink-0 flex-col items-center gap-3 text-center"
                >
                  <Avatar className="size-20">
                    {imageUrl && <AvatarImage src={imageUrl} alt={role.tag} />}
                    <AvatarFallback>{getInitials(role.tag)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-h-20 w-full flex-col gap-2">
                    <p className="line-clamp-2 text-sm leading-5 font-medium">
                      {role.tag}
                    </p>
                    {role.role && (
                      <p className="text-muted-foreground line-clamp-3 text-xs leading-5">
                        {role.role}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export type { ItemDetails, MediaItemDetailsProps } from "./types";

"use client";

import Image from "next/image";
import { Check, MoreHorizontal, Play, Share2, Star } from "lucide-react";
import {
  getPlexImageUrl,
  type ContinueWatchingItem,
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
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { RouterOutputs } from "~/trpc/react";
import type { MediaPlayerItem } from "~/types/media-player";

type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;
type MetadataItem = ItemDetails["item"];

interface MediaItemDetailsProps {
  details: ItemDetails;
  serverId: string;
}

export function MediaItemDetails({ details, serverId }: MediaItemDetailsProps) {
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const { item, serverUrl, authToken, serverName } = details;
  const imageServerUrl = serverUrl ?? undefined;
  const imageAuthToken = authToken ?? undefined;
  const posterUrl = getPosterUrl(item, imageServerUrl, imageAuthToken);
  const backdropUrl = getBackdropUrl(item, imageServerUrl, imageAuthToken);
  const progressPercent = getProgressPercent(item);
  const timeRemaining = formatTimeRemaining(item);
  const directorNames = item.Director?.map((director) => director.tag) ?? [];
  const genres = item.Genre?.slice(0, 3).map((genre) => genre.tag) ?? [];
  const ratingLabel = getRatingLabel(item);
  const metadata = getMetadataItems(item);
  const technicalRows = getTechnicalRows(item);
  const canPlay = Boolean(imageServerUrl && imageAuthToken);
  const playLabel = progressPercent > 0 ? "Resume" : "Play";

  const handlePlay = () => {
    if (!imageServerUrl || !imageAuthToken) {
      return;
    }

    const playableItem: MediaPlayerItem = {
      ...(item as ContinueWatchingItem),
      hubTitle: item.librarySectionTitle,
      hubType: "metadata",
      serverId,
      serverUrl: imageServerUrl,
      authToken: imageAuthToken,
      progressPercent,
      isCompleted: Boolean(item.viewCount),
      timeRemaining:
        item.duration && item.viewOffset
          ? item.duration - item.viewOffset
          : undefined,
    };

    openPlayer(playableItem);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-8 pb-24 md:pb-8">
      <section className="relative isolate overflow-hidden rounded-2xl">
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
        <div className="from-background via-background/90 to-background/40 absolute inset-0 -z-10 bg-gradient-to-r" />
        <div className="from-background via-background/30 absolute inset-0 -z-10 bg-gradient-to-t to-transparent" />

        <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:p-8">
          <div className="flex w-full flex-col gap-3 sm:w-[220px] lg:shrink-0">
            <div className="bg-muted ring-border relative aspect-[2/3] overflow-hidden rounded-xl shadow-2xl ring-1">
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

          <div className="flex min-w-0 flex-1 flex-col justify-end gap-5 lg:max-w-3xl">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{getTypeLabel(item.type)}</Badge>
                <Badge variant="outline">{item.librarySectionTitle}</Badge>
                <Badge variant="outline">{serverName ?? "Plex server"}</Badge>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                {getDisplayTitle(item)}
              </h1>
              {directorNames.length > 0 && (
                <p className="text-muted-foreground">
                  Directed by {directorNames.join(", ")}
                </p>
              )}
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                {metadata.map((value) => (
                  <span key={value}>{value}</span>
                ))}
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
              <Button size="lg" onClick={handlePlay} disabled={!canPlay}>
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
                  className="flex w-28 shrink-0 flex-col items-center gap-2 text-center"
                >
                  <Avatar className="size-20">
                    {imageUrl && <AvatarImage src={imageUrl} alt={role.tag} />}
                    <AvatarFallback>{getInitials(role.tag)}</AvatarFallback>
                  </Avatar>
                  <div className="flex w-full flex-col gap-1">
                    <p className="truncate text-sm font-medium">{role.tag}</p>
                    {role.role && (
                      <p className="text-muted-foreground line-clamp-2 text-xs">
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

function getPosterUrl(
  item: MetadataItem,
  serverUrl: string | undefined,
  authToken: string | undefined,
) {
  return getPlexImageUrl(
    item.type === "episode"
      ? (item.grandparentThumb ?? item.thumb)
      : item.thumb,
    serverUrl,
    authToken,
    { width: 440, height: 660 },
  );
}

function getBackdropUrl(
  item: MetadataItem,
  serverUrl: string | undefined,
  authToken: string | undefined,
) {
  return getPlexImageUrl(
    item.art ?? item.grandparentArt,
    serverUrl,
    authToken,
    { width: 1280, height: 720 },
  );
}

function getDisplayTitle(item: MetadataItem) {
  return item.type === "episode" && item.grandparentTitle
    ? item.grandparentTitle
    : item.title;
}

function getTypeLabel(type: string) {
  switch (type) {
    case "movie":
      return "Movie";
    case "show":
      return "TV Show";
    case "episode":
      return "Episode";
    default:
      return type;
  }
}

function getMetadataItems(item: MetadataItem) {
  return [
    item.year?.toString(),
    formatDuration(item.duration),
    item.contentRating,
    item.type === "episode" && item.parentIndex && item.index
      ? `S${item.parentIndex} E${item.index}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
}

function formatDuration(durationMs: number | undefined) {
  if (!durationMs) {
    return undefined;
  }

  const totalMinutes = Math.round(durationMs / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}min`;
  }

  return minutes === 0 ? `${hours}hr` : `${hours}hr ${minutes}min`;
}

function getProgressPercent(item: MetadataItem) {
  if (!item.viewOffset || !item.duration) {
    return 0;
  }

  return Math.round((item.viewOffset / item.duration) * 100);
}

function formatTimeRemaining(item: MetadataItem) {
  if (!item.viewOffset || !item.duration || item.viewOffset >= item.duration) {
    return undefined;
  }

  const remainingMs = item.duration - item.viewOffset;
  const minutes = Math.ceil(remainingMs / 1000 / 60);

  if (minutes < 60) {
    return `${minutes}min left`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes === 0
    ? `${hours}hr left`
    : `${hours}hr ${remainingMinutes}min left`;
}

function getRatingLabel(item: MetadataItem) {
  const rating = item.Rating?.[0]?.value ?? item.audienceRating ?? item.rating;

  if (!rating) {
    return undefined;
  }

  return rating <= 10
    ? `${Math.round(rating * 10)}%`
    : `${Math.round(rating)}%`;
}

function getTechnicalRows(item: MetadataItem) {
  const media = item.Media?.[0];
  const streams = media?.Part?.[0]?.Stream ?? [];
  const videoStream = streams.find((stream) => stream.streamType === 1);
  const audioStream =
    streams.find((stream) => stream.streamType === 2 && stream.selected) ??
    streams.find((stream) => stream.streamType === 2);
  const subtitleStream =
    streams.find((stream) => stream.streamType === 3 && stream.selected) ??
    streams.find((stream) => stream.streamType === 3);

  return [
    {
      label: "Video",
      value: media
        ? `${media.videoResolution} (${formatCodec(videoStream?.codec ?? media.videoCodec)})`
        : undefined,
    },
    {
      label: "Audio",
      value: audioStream?.extendedDisplayTitle ?? audioStream?.displayTitle,
    },
    {
      label: "Subtitles",
      value:
        subtitleStream?.extendedDisplayTitle ?? subtitleStream?.displayTitle,
    },
  ].filter((row): row is { label: string; value: string } =>
    Boolean(row.value),
  );
}

function formatCodec(codec: string) {
  if (codec.toLowerCase() === "h264") {
    return "H.264";
  }

  if (codec.toLowerCase() === "hevc") {
    return "HEVC";
  }

  return codec.toUpperCase();
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

"use client";

import * as React from "react";
import Image from "next/image";
import { getThumbnailUrl, type ProcessedSearchResult } from "@multiplex/plex-query";
import { Badge } from "~/components/ui/badge";
import { Calendar, Clock, Star, Server } from "lucide-react";

interface SearchResultItemProps {
  result: ProcessedSearchResult;
}

export function SearchResultItem({ result }: SearchResultItemProps) {
  const formatDuration = (duration?: number) => {
    if (!duration) return null;
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getMediaTypeLabel = (type: string) => {
    switch (type) {
      case "movie":
        return "Movie";
      case "show":
        return "TV Show";
      case "episode":
        return "Episode";
      case "artist":
        return "Artist";
      case "album":
        return "Album";
      case "track":
        return "Track";
      case "person":
        return "Person";
      case "collection":
        return "Collection";
      default:
        return type;
    }
  };

  const getSecondaryTitle = () => {
    if (
      result.type === "episode" &&
      result.grandparentTitle &&
      result.parentTitle
    ) {
      return `${result.grandparentTitle} - ${result.parentTitle}`;
    }
    if (result.type === "track" && result.artistName && result.albumName) {
      return `${result.artistName} - ${result.albumName}`;
    }
    if (result.type === "album" && result.artistName) {
      return result.artistName;
    }
    return null;
  };

  const getEpisodeInfo = () => {
    if (
      result.type === "episode" &&
      result.seasonNumber &&
      result.episodeNumber
    ) {
      return `S${result.seasonNumber.toString().padStart(2, "0")}E${result.episodeNumber.toString().padStart(2, "0")}`;
    }
    return null;
  };

  // Create a compatible object for getThumbnailUrl (same as continue watching uses)
  const thumbnailUrl = getThumbnailUrl(
    {
      type: result.type,
      thumb: result.thumb,
      grandparentThumb: undefined, // Not available in search results
      // Required fields for ContinueWatchingItem that we don't use in thumbnail generation
      ratingKey: result.ratingKey,
      key: result.key,
      guid: result.guid,
      title: result.title,
      librarySectionTitle: result.librarySection ?? "",
      librarySectionID: 1,
      librarySectionKey: "",
      serverId: result.serverId,
      // Additional required fields for ContinueWatchingItem
      hubTitle: "",
      hubType: "",
    },
    result.serverUrl,
    result.authToken,
  );

  return (
    <div className="flex w-full items-center gap-3 p-2">
      {/* Thumbnail placeholder */}
      <div className="bg-muted relative flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-md">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={result.title}
            className="h-full w-full rounded-md object-cover"
            fill
            sizes="48px"
          />
        ) : (
          <div className="text-muted-foreground text-xs font-medium">
            {getMediaTypeLabel(result.type).charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium">{result.title}</h3>

            {getSecondaryTitle() && (
              <p className="text-muted-foreground truncate text-xs">
                {getSecondaryTitle()}
              </p>
            )}

            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {getMediaTypeLabel(result.type)}
              </Badge>

              {getEpisodeInfo() && (
                <Badge variant="outline" className="text-xs">
                  {getEpisodeInfo()}
                </Badge>
              )}

              {result.year && (
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Calendar className="h-3 w-3" />
                  {result.year}
                </div>
              )}

              {result.duration && (
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  {formatDuration(result.duration)}
                </div>
              )}

              {result.rating && result.rating > 0 && (
                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Star className="h-3 w-3" />
                  {result.rating.toFixed(1)}
                </div>
              )}
            </div>
          </div>

          {/* Server info */}
          <div className="text-muted-foreground flex flex-shrink-0 items-center gap-1 text-xs">
            <Server className="h-3 w-3" />
            <span className="max-w-20 truncate" title={result.serverName}>
              {result.serverName}
            </span>
          </div>
        </div>

        {result.summary && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
            {result.summary}
          </p>
        )}
      </div>
    </div>
  );
}

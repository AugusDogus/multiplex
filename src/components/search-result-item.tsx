"use client";

import * as React from "react";
import { Badge } from "~/components/ui/badge";
import { Calendar, Clock, Star, Server } from "lucide-react";
import type { ProcessedSearchResult } from "~/lib/plex.tv/schemas/search-schemas";
import { getThumbnailUrl } from "~/lib/plex.tv/utils/continue-watching-utils";

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
      case 'movie':
        return 'Movie';
      case 'show':
        return 'TV Show';
      case 'episode':
        return 'Episode';
      case 'artist':
        return 'Artist';
      case 'album':
        return 'Album';
      case 'track':
        return 'Track';
      case 'person':
        return 'Person';
      case 'collection':
        return 'Collection';
      default:
        return type;
    }
  };

  const getSecondaryTitle = () => {
    if (result.type === 'episode' && result.grandparentTitle && result.parentTitle) {
      return `${result.grandparentTitle} - ${result.parentTitle}`;
    }
    if (result.type === 'track' && result.artistName && result.albumName) {
      return `${result.artistName} - ${result.albumName}`;
    }
    if (result.type === 'album' && result.artistName) {
      return result.artistName;
    }
    return null;
  };

  const getEpisodeInfo = () => {
    if (result.type === 'episode' && result.seasonNumber && result.episodeNumber) {
      return `S${result.seasonNumber.toString().padStart(2, '0')}E${result.episodeNumber.toString().padStart(2, '0')}`;
    }
    return null;
  };

  // Create a compatible object for getThumbnailUrl (same as continue watching uses)
  const thumbnailUrl = getThumbnailUrl(
    {
      ...result,
      grandparentThumb: undefined, // Not available in search results
    } as any,
    result.serverUrl,
    result.authToken,
  );
  
  // Debug logging to check server URL
  React.useEffect(() => {
    console.log('🖼️ [SearchResultItem] Image debug:', {
      title: result.title,
      serverUrl: result.serverUrl,
      authToken: result.authToken ? `${result.authToken.substring(0, 10)}...` : 'none',
      thumb: result.thumb,
      thumbnailUrl
    });
  }, [result, thumbnailUrl]);

  return (
    <div className="flex items-center gap-3 p-2 w-full">
      {/* Thumbnail placeholder */}
      <div className="flex-shrink-0 w-12 h-12 bg-muted rounded-md flex items-center justify-center">
        {thumbnailUrl ? (
          <img 
            src={thumbnailUrl} 
            alt={result.title}
            className="w-full h-full object-cover rounded-md"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground text-xs font-medium">
            {getMediaTypeLabel(result.type).charAt(0)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm truncate">
              {result.title}
            </h3>
            
            {getSecondaryTitle() && (
              <p className="text-xs text-muted-foreground truncate">
                {getSecondaryTitle()}
              </p>
            )}
            
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">
                {getMediaTypeLabel(result.type)}
              </Badge>
              
              {getEpisodeInfo() && (
                <Badge variant="outline" className="text-xs">
                  {getEpisodeInfo()}
                </Badge>
              )}
              
              {result.year && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {result.year}
                </div>
              )}
              
              {result.duration && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDuration(result.duration)}
                </div>
              )}
              
              {result.rating && result.rating > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3" />
                  {result.rating.toFixed(1)}
                </div>
              )}
            </div>
          </div>
          
          {/* Server info */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
            <Server className="h-3 w-3" />
            <span className="truncate max-w-20" title={result.serverName}>
              {result.serverName}
            </span>
          </div>
        </div>
        
        {result.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {result.summary}
          </p>
        )}
      </div>
    </div>
  );
}
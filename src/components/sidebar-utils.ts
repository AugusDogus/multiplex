import { Film, ListVideo, Music, Play, Tv, TvMinimal } from "lucide-react";

// Helper function to get the appropriate icon for a source type
export function getSourceIcon(sourceType: string) {
  switch (sourceType) {
    case "movies":
      return Film;
    case "tv":
      return TvMinimal;
    case "music":
      return Music;
    case "playlist":
      return ListVideo;
    case "Live TV & DVR":
      return Tv;
    default:
      return Play;
  }
}

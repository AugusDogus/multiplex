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

// Helper function to check if current URL matches the source href
export function isUrlActive(pathname: string, searchParams: URLSearchParams, sourceHref: string): boolean {
  try {
    // Parse source href manually to avoid using window.location.origin during SSR
    const sourceUrl = new URL(sourceHref, 'http://localhost');
    
    // Check if pathname matches
    if (sourceUrl.pathname !== pathname) {
      return false;
    }
    
    // Check if all source search params are present in current URL
    for (const [key, value] of sourceUrl.searchParams) {
      if (searchParams.get(key) !== value) {
        return false;
      }
    }
    
    return true;
  } catch {
    // Fallback to simple pathname check if URL parsing fails
    return pathname === sourceHref || pathname.startsWith(sourceHref);
  }
}

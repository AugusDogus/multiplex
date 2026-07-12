"use client";

import { cn } from "~/lib/utils";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import type { MediaPlayerItem } from "~/types/media-player";
import { MediaPlayerChromeFade } from "./media-player-chrome-fade";

export { MediaPlayerChromeFade } from "./media-player-chrome-fade";
import {
  formatEpisodeInfo,
  getMediaSubtitle,
  getMediaTitle,
  isEpisode,
} from "./utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Media Player Overlay
   Title, metadata, and status overlays for the media player
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerTitleChromeProps {
  item: MediaPlayerItem;
  className?: string;
}

export function MediaPlayerTitleChrome({
  item,
  className = "",
}: MediaPlayerTitleChromeProps) {
  const title = getMediaTitle(item);
  const subtitle = getMediaSubtitle(item);
  const episodeInfo = isEpisode(item) ? formatEpisodeInfo(item) : null;

  return (
    <div
      className={cn(
        "bg-gradient-to-b from-black/80 via-black/40 to-transparent p-6 pb-12",
        className,
      )}
    >
      <div className="max-w-4xl">
        <h1 className="mb-2 line-clamp-2 text-2xl font-bold text-white md:text-3xl">
          {title}
        </h1>

        {subtitle && (
          <div className="mb-2 flex items-center gap-2 text-white/90">
            {episodeInfo && (
              <span className="rounded bg-white/20 px-2 py-1 text-sm font-medium">
                {episodeInfo}
              </span>
            )}
            <p className="line-clamp-1 text-lg">{subtitle}</p>
          </div>
        )}

        <div className="flex items-center gap-4 text-sm text-white/70">
          {item.year && <span>{item.year}</span>}

          {item.contentRating && (
            <span className="rounded border border-white/30 px-1 text-xs">
              {item.contentRating}
            </span>
          )}

          {item.duration && (
            <span>{Math.floor(item.duration / 1000 / 60)}min</span>
          )}

          {item.librarySectionTitle && <span>{item.librarySectionTitle}</span>}
        </div>
      </div>
    </div>
  );
}

interface MediaPlayerOverlayProps {
  /**
   * Current media item
   */
  item: MediaPlayerItem;
  /**
   * Whether the overlay is visible
   */
  isVisible: boolean;
  /**
   * Whether the video is loading
   */
  isLoading: boolean;
  /**
   * Error message to display
   */
  error: string | null;
  /**
   * When false, title is rendered elsewhere (e.g. inside mobile chrome fade).
   */
  showTitle?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export function MediaPlayerOverlay({
  item,
  isVisible,
  isLoading,
  error,
  showTitle = true,
  className = "",
}: MediaPlayerOverlayProps) {
  const isBuffering = usePlayerStateSelector((state) => state.isBuffering);
  const showSpinner = !error && (isLoading || isBuffering);

  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      {/* Title and Metadata Overlay (desktop) */}
      {showTitle && !isLoading && !error && (
        <MediaPlayerChromeFade
          visible={isVisible}
          className="absolute top-0 right-0 left-0"
        >
          <MediaPlayerTitleChrome item={item} />
        </MediaPlayerChromeFade>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-4 max-w-lg text-center text-white">
            <div className="mb-6 text-6xl">⚠️</div>
            <h2 className="mb-4 text-2xl font-bold">Playback Error</h2>
            <p className="mb-6 leading-relaxed text-white/80">{error}</p>
            <div className="text-sm text-white/60">
              <p>This could be due to:</p>
              <ul className="mx-auto mt-2 max-w-md list-inside list-disc space-y-1 text-left">
                <li>Network connectivity issues</li>
                <li>Unsupported video format</li>
                <li>Server authentication problems</li>
                <li>Insufficient permissions</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Loading / Buffering Indicator */}
      <div
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300",
          showSpinner ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-3 border-white/30 border-t-white"></div>
        </div>
      </div>
    </div>
  );
}

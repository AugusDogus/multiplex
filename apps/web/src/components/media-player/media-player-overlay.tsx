"use client";

import React from "react";
import { cn } from "~/lib/utils";
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

/** Strong ease-out — enter slightly slower than exit (asymmetric). */
export const mediaPlayerControlsTransition = {
  base: "transition-opacity ease-[cubic-bezier(0.23,1,0.32,1)]",
  visible: "opacity-100 duration-200",
  hidden:
    "pointer-events-none opacity-0 duration-150 [&_*]:pointer-events-none",
} as const;

export function mediaPlayerChromeClassName(
  isVisible: boolean,
  className?: string,
) {
  return cn(
    mediaPlayerControlsTransition.base,
    isVisible
      ? cn(mediaPlayerControlsTransition.visible, "pointer-events-none")
      : mediaPlayerControlsTransition.hidden,
    className,
  );
}

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

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="text-center text-white">
            <div className="relative mb-4">
              <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-white/20 border-t-white"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-pulse rounded-full bg-white/10"></div>
              </div>
            </div>
            <h2 className="mb-2 text-xl font-semibold">Loading Video</h2>
            <p className="max-w-md text-white/70">
              Preparing your video for playback...
            </p>
          </div>
        </div>
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

      {/* Buffering Indicator */}
      {!isLoading && !error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-300 group-data-[buffering=true]:opacity-100">
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-3 border-white/30 border-t-white"></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Fade In/Out Animation Variants
   ──────────────────────────────────────────────────────────── */

interface FadeOverlayProps {
  /**
   * Whether the overlay should be visible
   */
  isVisible: boolean;
  /**
   * Children to render
   */
  children: React.ReactNode;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Animation duration in milliseconds
   */
  duration?: number;
}

/**
 * Reusable fade overlay component for smooth transitions
 */
/** @deprecated Use MediaPlayerChromeFade — kept as alias for existing imports */
export function FadeOverlay({
  isVisible,
  children,
  className = "",
}: FadeOverlayProps) {
  return (
    <MediaPlayerChromeFade visible={isVisible} className={className}>
      {children}
    </MediaPlayerChromeFade>
  );
}

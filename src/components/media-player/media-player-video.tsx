"use client";

import { useAtom } from "jotai";
import React, { forwardRef, useCallback, useEffect, useState } from "react";
import { playerStatusAtom } from "~/atoms/media-player";
import type { MediaPlayerItem } from "~/types/media-player";
import { useVideoElement } from "./hooks/use-video-element";
import { getStartTime } from "./utils/media-player-utils";
import {
  generatePlexStreamUrl,
  hasValidStreamingData,
} from "./utils/plex-stream-utils";

/* ────────────────────────────────────────────────────────────
   Media Player Video Component
   HTML5 video element with Plex streaming integration
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerVideoProps {
  /**
   * Media item to play
   */
  item: MediaPlayerItem;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Callback fired when user clicks the video (for play/pause toggle)
   */
  onVideoClick?: () => void;
  /**
   * Callback fired when user double-clicks the video (for fullscreen toggle)
   */
  onVideoDoubleClick?: () => void;
  /**
   * Callback fired when video ends
   */
  onVideoEnded?: () => void;
}

export const MediaPlayerVideo = forwardRef<
  HTMLVideoElement,
  MediaPlayerVideoProps
>(
  (
    { item, className = "", onVideoClick, onVideoDoubleClick, onVideoEnded },
    ref,
  ) => {
    const [playerStatus] = useAtom(playerStatusAtom);
    const [videoSrc, setVideoSrc] = useState<string>("");
    const [hasError, setHasError] = useState(false);

    // Use the video element hook for event handling
    useVideoElement(ref as React.RefObject<HTMLVideoElement>, {
      onEnded: onVideoEnded,
      onLoadedMetadata: () => {
        // Set the initial playback position when video loads
        if (ref && "current" in ref && ref.current) {
          const startTime = getStartTime(item);
          if (startTime > 0) {
            ref.current.currentTime = startTime;
          }
        }
      },
    });

    /**
     * Generate the video source URL
     */
    useEffect(() => {
      if (!hasValidStreamingData(item)) {
        setHasError(true);
        return;
      }

      try {
        const streamUrl = generatePlexStreamUrl(
          item,
          item.serverUrl,
          item.authToken,
        );
        setVideoSrc(streamUrl);
        setHasError(false);
      } catch (error) {
        console.error("Failed to generate stream URL:", error);
        setHasError(true);
      }
    }, [item]);

    /**
     * Handle video click for play/pause toggle
     */
    const handleVideoClick = useCallback(() => {
      onVideoClick?.();
    }, [onVideoClick]);

    /**
     * Handle video double-click for fullscreen toggle
     */
    const handleVideoDoubleClick = useCallback(() => {
      onVideoDoubleClick?.();
    }, [onVideoDoubleClick]);

    /**
     * Handle video load error
     */
    const handleVideoError = useCallback(() => {
      setHasError(true);
    }, []);

    if (hasError || !videoSrc) {
      return (
        <div
          className={`flex h-full w-full items-center justify-center bg-black ${className}`}
        >
          <div className="text-center text-white">
            <div className="mb-2 text-xl">⚠️</div>
            <div className="mb-1 text-lg font-semibold">
              Unable to load video
            </div>
            <div className="text-sm text-white/70">
              {hasError
                ? "There was an error loading the video stream"
                : "Generating stream URL..."}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`relative h-full w-full overflow-hidden bg-black ${className}`}
      >
        <video
          ref={ref}
          autoPlay
          src={videoSrc}
          className="h-full w-full cursor-pointer object-contain"
          onClick={handleVideoClick}
          onDoubleClick={handleVideoDoubleClick}
          onError={handleVideoError}
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
          disableRemotePlayback
        />

        {/* Loading Overlay */}
        {playerStatus.status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center text-white">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-white"></div>
              <div className="text-lg font-semibold">Loading video...</div>
            </div>
          </div>
        )}

        {/* Buffering Overlay */}
        {playerStatus.status === "buffering" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="text-center text-white">
              <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
              <div className="text-sm">Buffering...</div>
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {playerStatus.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="max-w-md px-4 text-center text-white">
              <div className="mb-3 text-2xl">⚠️</div>
              <div className="mb-2 text-lg font-semibold">Playback Error</div>
              <div className="text-sm text-white/80">
                {playerStatus.message ||
                  "An error occurred during video playback"}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

MediaPlayerVideo.displayName = "MediaPlayerVideo";

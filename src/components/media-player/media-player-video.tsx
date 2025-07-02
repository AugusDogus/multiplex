"use client";

import { useAtom, useAtomValue } from "jotai";
import { forwardRef, useCallback, useMemo } from "react";
import {
  mediaPlayerStateAtom,
  playerStatusAtom,
  updatePlaybackStateAtom,
} from "~/atoms/media-player";
import type { MediaPlayerItem } from "~/types/media-player";
import { getVideoElementError } from "./utils/media-player-utils";
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
   * Object fit mode for the video element
   */
  objectFit?: "contain" | "cover";
  /**
   * Callback fired when user clicks the video (for play/pause toggle)
   */
  onVideoClick?: () => void;
  /**
   * Callback fired when user double-clicks the video (for fullscreen toggle)
   */
  onVideoDoubleClick?: () => void;
  /**
   * Callback fired when user scrolls on the video (for volume control)
   */
  onVolumeScroll?: (delta: number) => void;
  /**
   * Callback fired when video ends
   */
  onVideoEnded?: () => void;
  /**
   * Callback fired when video starts playing
   */
  onVideoPlay?: () => void;
  /**
   * Callback fired when video is paused
   */
  onVideoPause?: () => void;
  /**
   * Callback fired when video time updates
   */
  onVideoTimeUpdate?: (currentTime: number) => void;
  /**
   * Callback fired when video seeking is complete
   */
  onVideoSeeked?: (currentTime: number) => void;
}

export const MediaPlayerVideo = forwardRef<
  HTMLVideoElement,
  MediaPlayerVideoProps
>(
  (
    {
      item,
      className = "",
      objectFit = "contain",
      onVideoClick,
      onVideoDoubleClick,
      onVolumeScroll,
      onVideoEnded,
      onVideoPlay,
      onVideoPause,
      onVideoTimeUpdate,
      onVideoSeeked,
    },
    ref,
  ) => {
    const [playerStatus] = useAtom(playerStatusAtom);
    const [, updateState] = useAtom(updatePlaybackStateAtom);
    const state = useAtomValue(mediaPlayerStateAtom);

    // Derive video source URL and error state from item
    const { videoSrc, hasError } = useMemo(() => {
      if (!hasValidStreamingData(item)) {
        return { videoSrc: "", hasError: true };
      }

      try {
        const streamUrl = generatePlexStreamUrl(
          item,
          item.serverUrl,
          item.authToken,
        );
        return { videoSrc: streamUrl, hasError: false };
      } catch (error) {
        console.error(
          "Failed to generate stream URL:",
          error instanceof Error ? error.message : error,
        );
        return { videoSrc: "", hasError: true };
      }
    }, [item]);

    // Handle video metadata loaded
    const handleLoadedMetadata = useCallback(() => {
      console.log("🎬 Video: Metadata loaded, setting start time");

      if (ref && "current" in ref && ref.current) {
        // Update state with duration and ready status
        updateState({
          duration: ref.current.duration,
          canPlay: true,
          isLoading: false,
        });

        // Set initial playback position from atom state
        const startTime = state.currentTime;
        if (startTime > 0) {
          console.log(`🎬 Video: Setting start time to ${startTime}s`);
          ref.current.currentTime = startTime;
        }
      }
    }, [ref, updateState, state.currentTime]);

    // Handle video play event
    const handlePlay = useCallback(() => {
      updateState({ isPlaying: true });
      onVideoPlay?.();
    }, [updateState, onVideoPlay]);

    // Handle video pause event
    const handlePause = useCallback(() => {
      updateState({ isPlaying: false });
      onVideoPause?.();
    }, [updateState, onVideoPause]);

    // Handle video ended event
    const handleEnded = useCallback(() => {
      updateState({ isPlaying: false });
      onVideoEnded?.();
    }, [updateState, onVideoEnded]);

    // Handle time update events
    const handleTimeUpdate = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        const currentTime = ref.current.currentTime;
        updateState({ currentTime });
        onVideoTimeUpdate?.(currentTime);
      }
    }, [ref, updateState, onVideoTimeUpdate]);

    // Handle seeked events
    const handleSeeked = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updateState({ isBuffering: false });
        onVideoSeeked?.(ref.current.currentTime);
      }
    }, [ref, updateState, onVideoSeeked]);

    // Handle seeking event
    const handleSeeking = useCallback(() => {
      updateState({ isBuffering: true });
    }, [updateState]);

    // Handle waiting event (buffering starts)
    const handleWaiting = useCallback(() => {
      updateState({ isBuffering: true });
    }, [updateState]);

    // Handle can play event (buffering ends)
    const handleCanPlay = useCallback(() => {
      updateState({ isBuffering: false, canPlay: true });
    }, [updateState]);

    // Handle can play through event
    const handleCanPlayThrough = useCallback(() => {
      updateState({
        isBuffering: false,
        canPlay: true,
        isLoading: false,
      });
    }, [updateState]);

    // Handle load start event
    const handleLoadStart = useCallback(() => {
      updateState({
        isLoading: true,
        error: null,
        canPlay: false,
      });
    }, [updateState]);

    // Handle loaded data event
    const handleLoadedData = useCallback(() => {
      updateState({
        isLoading: false,
        canPlay: true,
      });
    }, [updateState]);

    // Handle progress event (buffering progress)
    const handleProgress = useCallback(() => {
      if (
        ref &&
        "current" in ref &&
        ref.current &&
        ref.current.buffered.length > 0
      ) {
        const bufferedTime = ref.current.buffered.end(
          ref.current.buffered.length - 1,
        );
        updateState({ bufferedTime });
      }
    }, [ref, updateState]);

    // Handle duration change event
    const handleDurationChange = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updateState({ duration: ref.current.duration });
      }
    }, [ref, updateState]);

    // Handle volume change event
    const handleVolumeChange = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updateState({
          volume: ref.current.volume,
          isMuted: ref.current.muted,
        });
      }
    }, [ref, updateState]);

    // Handle stalled event
    const handleStalled = useCallback(() => {
      updateState({ isBuffering: true });
    }, [updateState]);

    // Handle suspend event
    const handleSuspend = useCallback(() => {
      updateState({ isBuffering: false });
    }, [updateState]);

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
     * Handle video wheel scroll for volume control
     */
    const handleVideoWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault(); // Prevent page scrolling
        const delta = -e.deltaY; // Invert delta so scroll up increases volume
        onVolumeScroll?.(delta);
      },
      [onVolumeScroll],
    );

    /**
     * Handle video load error
     */
    const handleVideoError = useCallback(() => {
      if (ref && "current" in ref && ref.current?.error) {
        const errorMessage = getVideoElementError(ref.current.error);
        updateState({
          error: errorMessage,
          isLoading: false,
          isBuffering: false,
        });
      }
    }, [ref, updateState]);

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
          className={`h-full w-full cursor-pointer ${objectFit === "cover" ? "object-cover" : "object-contain"}`}
          onClick={handleVideoClick}
          onDoubleClick={handleVideoDoubleClick}
          onWheel={handleVideoWheel}
          onError={handleVideoError}
          onLoadStart={handleLoadStart}
          onLoadedData={handleLoadedData}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onCanPlayThrough={handleCanPlayThrough}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onWaiting={handleWaiting}
          onStalled={handleStalled}
          onSuspend={handleSuspend}
          onProgress={handleProgress}
          onDurationChange={handleDurationChange}
          onVolumeChange={handleVolumeChange}
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

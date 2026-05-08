"use client";

import { forwardRef, useCallback, useMemo, useRef } from "react";
import type { PointerEvent } from "react";
import { useMediaPlayerStore } from "~/stores/media-player-store";
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

const HOLD_PLAYBACK_RATE = 2;
const HOLD_CLICK_SUPPRESSION_MS = 200;

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
    const error = useMediaPlayerStore((state) => state.error);
    const isLoading = useMediaPlayerStore((state) => state.isLoading);
    const isBuffering = useMediaPlayerStore((state) => state.isBuffering);
    const canPlay = useMediaPlayerStore((state) => state.canPlay);
    const volume = useMediaPlayerStore((state) => state.volume);
    const isMuted = useMediaPlayerStore((state) => state.isMuted);
    const currentTime = useMediaPlayerStore((state) => state.currentTime);
    const { updatePlaybackState } = useMediaPlayerStore();
    const holdPlaybackRateRef = useRef<number | null>(null);
    const holdPointerIdRef = useRef<number | null>(null);
    const holdStartedAtRef = useRef<number | null>(null);
    const shouldSuppressClickRef = useRef(false);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const currentHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);

    // Compute player status locally to avoid object reference issues
    const playerStatus = useMemo(() => {
      if (error) return { status: "error", message: error } as const;
      if (isLoading) return { status: "loading" } as const;
      if (isBuffering) return { status: "buffering" } as const;
      if (!canPlay) return { status: "waiting" } as const;
      return { status: "ready" } as const;
    }, [error, isLoading, isBuffering, canPlay]);

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
        updatePlaybackState({
          duration: ref.current.duration,
          canPlay: true,
          isLoading: false,
        });

        // Set initial playback position from store state
        const startTime = currentTime;
        if (startTime > 0) {
          console.log(`🎬 Video: Setting start time to ${startTime}s`);
          ref.current.currentTime = startTime;
        }

        // Synchronize volume and mute state with store state
        console.log(
          `🎬 Video: Synchronizing volume (${volume}) and mute state (${isMuted})`,
        );
        ref.current.volume = volume;
        ref.current.muted = isMuted;
      }
    }, [ref, updatePlaybackState, currentTime, volume, isMuted]);

    // Handle video play event
    const handlePlay = useCallback(() => {
      updatePlaybackState({ isPlaying: true });
      onVideoPlay?.();
    }, [updatePlaybackState, onVideoPlay]);

    // Handle video pause event
    const handlePause = useCallback(() => {
      updatePlaybackState({ isPlaying: false });
      onVideoPause?.();
    }, [updatePlaybackState, onVideoPause]);

    // Handle video ended event
    const handleEnded = useCallback(() => {
      updatePlaybackState({ isPlaying: false });
      onVideoEnded?.();
    }, [updatePlaybackState, onVideoEnded]);

    // Handle time update events
    const handleTimeUpdate = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        const currentTime = ref.current.currentTime;
        updatePlaybackState({ currentTime });
        onVideoTimeUpdate?.(currentTime);
      }
    }, [ref, updatePlaybackState, onVideoTimeUpdate]);

    // Handle seeked events
    const handleSeeked = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updatePlaybackState({ isBuffering: false });
        onVideoSeeked?.(ref.current.currentTime);
      }
    }, [ref, updatePlaybackState, onVideoSeeked]);

    // Handle seeking event
    const handleSeeking = useCallback(() => {
      updatePlaybackState({ isBuffering: true });
    }, [updatePlaybackState]);

    // Handle waiting event (buffering starts)
    const handleWaiting = useCallback(() => {
      updatePlaybackState({ isBuffering: true });
    }, [updatePlaybackState]);

    // Handle can play event (buffering ends)
    const handleCanPlay = useCallback(() => {
      updatePlaybackState({ isBuffering: false, canPlay: true });
    }, [updatePlaybackState]);

    // Handle can play through event
    const handleCanPlayThrough = useCallback(() => {
      updatePlaybackState({
        isBuffering: false,
        canPlay: true,
        isLoading: false,
      });
    }, [updatePlaybackState]);

    // Handle load start event
    const handleLoadStart = useCallback(() => {
      updatePlaybackState({
        isLoading: true,
        error: null,
        canPlay: false,
      });
    }, [updatePlaybackState]);

    // Handle loaded data event
    const handleLoadedData = useCallback(() => {
      updatePlaybackState({
        isLoading: false,
        canPlay: true,
      });
    }, [updatePlaybackState]);

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
        updatePlaybackState({ bufferedTime });
      }
    }, [ref, updatePlaybackState]);

    // Handle duration change event
    const handleDurationChange = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updatePlaybackState({ duration: ref.current.duration });
      }
    }, [ref, updatePlaybackState]);

    // Handle volume change event
    const handleVolumeChange = useCallback(() => {
      if (ref && "current" in ref && ref.current) {
        updatePlaybackState({
          volume: ref.current.volume,
          isMuted: ref.current.muted,
        });
      }
    }, [ref, updatePlaybackState]);

    // Handle stalled event
    const handleStalled = useCallback(() => {
      updatePlaybackState({ isBuffering: true });
    }, [updatePlaybackState]);

    // Handle suspend event
    const handleSuspend = useCallback(() => {
      updatePlaybackState({ isBuffering: false });
    }, [updatePlaybackState]);

    /**
     * Handle video click for play/pause toggle
     */
    const handleVideoClick = useCallback(() => {
      if (shouldSuppressClickRef.current) {
        shouldSuppressClickRef.current = false;
        return;
      }

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
      (e: WheelEvent) => {
        e.preventDefault();
        const delta = -e.deltaY; // Invert delta so scroll up increases volume
        onVolumeScroll?.(delta);
      },
      [onVolumeScroll],
    );

    const restoreHoldPlaybackRate = useCallback(
      (pointerId: number) => {
        if (holdPointerIdRef.current !== pointerId) return;

        const video = videoElementRef.current;
        if (video && holdPlaybackRateRef.current != null) {
          video.playbackRate = holdPlaybackRateRef.current;
        }

        holdPlaybackRateRef.current = null;
        holdPointerIdRef.current = null;
        holdStartedAtRef.current = null;
      },
      [],
    );

    const handleVideoPointerDown = useCallback(
      (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (holdPointerIdRef.current != null) return;

        const video = videoElementRef.current;
        if (!video) return;

        holdPlaybackRateRef.current = video.playbackRate;
        holdPointerIdRef.current = event.pointerId;
        holdStartedAtRef.current = Date.now();
        video.playbackRate = HOLD_PLAYBACK_RATE;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [],
    );

    const handleVideoPointerEnd = useCallback(
      (event: PointerEvent<HTMLElement>) => {
        if (holdPointerIdRef.current !== event.pointerId) return;

        const holdStartedAt = holdStartedAtRef.current;
        if (
          holdStartedAt != null &&
          Date.now() - holdStartedAt >= HOLD_CLICK_SUPPRESSION_MS
        ) {
          shouldSuppressClickRef.current = true;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        restoreHoldPlaybackRate(event.pointerId);
      },
      [restoreHoldPlaybackRate],
    );

    /**
     * Internal ref to track the video element for cleanup
     */

    /**
     * Ref callback that combines forwarded ref with wheel event setup
     */
    const videoRefCallback = useCallback(
      (node: HTMLVideoElement | null) => {
        if (node == null) {
          if (videoElementRef.current != null && currentHandlerRef.current) {
            // Remove old event listener when component unmounts or ref changes
            videoElementRef.current.removeEventListener(
              "wheel",
              currentHandlerRef.current,
            );
          }
          // Also update forwarded ref
          if (typeof ref === "function") {
            ref(null);
          } else if (ref) {
            ref.current = null;
          }
          videoElementRef.current = null;
          currentHandlerRef.current = null;
          return;
        }

        // Remove old listener if element exists and handler changed
        if (
          videoElementRef.current &&
          currentHandlerRef.current &&
          currentHandlerRef.current !== handleVideoWheel
        ) {
          videoElementRef.current.removeEventListener(
            "wheel",
            currentHandlerRef.current,
          );
        }

        // Store references for cleanup
        videoElementRef.current = node;
        currentHandlerRef.current = handleVideoWheel;

        // Set forwarded ref
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }

        // Add wheel event listener with passive: false
        node.addEventListener("wheel", handleVideoWheel, { passive: false });
      },
      [ref, handleVideoWheel],
    );

    /**
     * Handle video load error
     */
    const handleVideoError = useCallback(() => {
      if (ref && "current" in ref && ref.current?.error) {
        const errorMessage = getVideoElementError(ref.current.error);
        updatePlaybackState({
          error: errorMessage,
          isLoading: false,
          isBuffering: false,
        });
      }
    }, [ref, updatePlaybackState]);

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
        onPointerDown={handleVideoPointerDown}
        onPointerUp={handleVideoPointerEnd}
        onPointerCancel={handleVideoPointerEnd}
        onPointerLeave={handleVideoPointerEnd}
        onLostPointerCapture={handleVideoPointerEnd}
      >
        <video
          ref={videoRefCallback}
          autoPlay
          src={videoSrc}
          className="h-full w-full cursor-pointer object-contain"
          onClick={handleVideoClick}
          onDoubleClick={handleVideoDoubleClick}
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
                {playerStatus.message ??
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

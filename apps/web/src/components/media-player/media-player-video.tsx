"use client";

import { FastForward } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";
import { cn } from "~/lib/utils";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { MediaPlayerItem } from "~/types/media-player";
import { useCaptionLines } from "./hooks/use-caption-lines";
import { usePlexSubtitleTrack } from "./hooks/use-plex-subtitle-track";
import { useResumePlayback } from "./hooks/use-resume-playback";
import { useSeekOverlay } from "./hooks/use-seek-overlay";
import { getVideoElementError } from "./utils/media-player-utils";
import {
  buildPlexPlaybackPlan,
  generatePlexStreamUrl,
  hasValidStreamingData,
  transcodeUsesOffsetTimeline,
} from "./utils/plex-stream-utils";
import { useSuppressNativeLongPress } from "./hooks/use-suppress-native-long-press";
import { useVideoPressGesture } from "./hooks/use-video-press-gesture";
import { MediaPlayerCaptionsOverlay } from "./media-player-captions-overlay";
import { MediaPlayerSeekOverlay } from "./media-player-seek-overlay";

/* ────────────────────────────────────────────────────────────
   Media Player Video Component
   HTML5 video element with Plex streaming integration
   ──────────────────────────────────────────────────────────── */

const HOLD_PLAYBACK_RATE = 2;
const HOLD_CLICK_SUPPRESSION_MS = 200;
// Pixels of pointer movement after press that disqualify the gesture as a
// tap or hold. Lets parent surfaces (e.g. drag-to-dismiss) take over without
// the video first triggering 2x playback or a controls toggle.
const POINTER_DRAG_TOLERANCE_PX = 10;
const DOUBLE_CLICK_SEEK_OVERLAY_MS = 2200;
const DOUBLE_CLICK_SEEK_SECONDS = 10;
// Matches Tailwind's `animate-ping` duration (1s).
const DOUBLE_CLICK_SEEK_PULSE_MS = 1000;

type DoubleClickSeekDirection = "backward" | "forward";

export interface MediaPlayerSeekFeedbackHandle {
  show: (
    direction: DoubleClickSeekDirection,
    seconds: number,
    accumulate?: boolean,
  ) => void;
  /** Visual seek feedback (overlay + pulse) without changing playback position. */
  presentSeek: (direction: DoubleClickSeekDirection) => void;
}

interface DoubleClickSeekPulse {
  direction: DoubleClickSeekDirection;
  id: number;
}

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
   * Quick tap on the video surface (mobile). Handled via pointerup, not click.
   */
  onMobileSurfaceTap?: (event: PointerEvent<HTMLElement>) => void;
  /**
   * Mobile mode: surface taps go to onMobileSurfaceTap; desktop uses onVideoClick.
   */
  useMobileSurfaceGestures?: boolean;
  /**
   * Imperative handle for showing seek feedback (e.g. keyboard shortcuts).
   */
  seekFeedbackRef?: RefObject<MediaPlayerSeekFeedbackHandle | null>;
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
      onMobileSurfaceTap,
      useMobileSurfaceGestures = false,
      seekFeedbackRef,
      onVolumeScroll,
      onVideoEnded,
      onVideoPlay,
      onVideoPause,
      onVideoTimeUpdate,
      onVideoSeeked,
    },
    ref,
  ) => {
    const volume = useMediaPlayerStore((state) => state.volume);
    const isMuted = useMediaPlayerStore((state) => state.isMuted);
    const playbackRate = useMediaPlayerStore((state) => state.playbackRate);
    const streamOffset = useMediaPlayerStore((state) => state.streamOffset);
    const playbackPlan = useMemo(() => buildPlexPlaybackPlan(item), [item]);
    const usesOffsetTimeline = transcodeUsesOffsetTimeline(item, streamOffset);
    const isLoading = useMediaPlayerStore((state) => state.isLoading);
    const showControls = useMediaPlayerStore((state) => state.showControls);
    const captionSize = useMediaPlayerStore((state) => state.captionSize);
    const { updatePlaybackState } = useMediaPlayerStore();
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const surfaceElementRef = useRef<HTMLDivElement | null>(null);
    const { plexSubtitleTrackSrc, handlePlexTrackLoad, captionTrack } =
      usePlexSubtitleTrack(
        videoElementRef,
        item,
        playbackPlan,
        usesOffsetTimeline ? streamOffset : 0,
      );
    const activeCaptions = useCaptionLines(captionTrack);
    const {
      captureResumeTimeOnLoadStart,
      applyResumeSeekOnMetadata,
      handleTimeUpdate: handleResumeTimeUpdate,
      handleSeeked: handleResumeSeeked,
      hasPendingResume,
    } = useResumePlayback({
      videoRef: videoElementRef,
      usesOffsetTimeline,
      streamOffset,
      isLoading,
      updatePlaybackState,
      onVideoTimeUpdate,
      onVideoSeeked,
    });
    const {
      overlay: seekOverlay,
      showOverlay: showSeekOverlay,
      clearOverlayTimeout: clearSeekOverlayTimeout,
    } = useSeekOverlay(DOUBLE_CLICK_SEEK_OVERLAY_MS);
    const [seekPulses, setSeekPulses] = useState<DoubleClickSeekPulse[]>([]);
    const seekPulseIdRef = useRef(0);
    const seekPulseTimeoutsRef = useRef(
      new Map<number, ReturnType<typeof setTimeout>>(),
    );
    const longPressRef = useSuppressNativeLongPress(useMobileSurfaceGestures);

    // Combined ref: forwards the surface element to both the long-press
    // suppression hook and our local ref (used for the non-passive wheel
    // listener below).
    const surfaceRef = useCallback(
      (node: HTMLDivElement | null) => {
        longPressRef(node);
        surfaceElementRef.current = node;
      },
      [longPressRef],
    );

    const media = item.Media?.[0];
    const partKey = media?.Part?.[0]?.key;
    const videoCodec = media?.videoCodec;
    const audioCodec = media?.audioCodec;
    const container = media?.container;
    const burnedSubtitleIndex = playbackPlan.burnedSubtitleIndex;

    // Derive video source URL and error state from item. `streamOffset` only
    // affects transcoded streams, where it gets baked into the URL so the
    // transcoder restarts at the requested position. Granular deps avoid
    // reloading when hydration only expands stream metadata.
    const { videoSrc, hasError } = useMemo(() => {
      if (!hasValidStreamingData(item)) {
        return { videoSrc: "", hasError: true };
      }

      try {
        const streamUrl = generatePlexStreamUrl(
          item,
          item.serverUrl,
          item.authToken,
          streamOffset,
          burnedSubtitleIndex,
        );
        return { videoSrc: streamUrl, hasError: false };
      } catch (error) {
        console.error(
          "Failed to generate stream URL:",
          error instanceof Error ? error.message : error,
        );
        return { videoSrc: "", hasError: true };
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- omit `item`; granular deps prevent reload on stream-only hydration
    }, [
      item.ratingKey,
      item.serverUrl,
      item.authToken,
      partKey,
      videoCodec,
      audioCodec,
      container,
      burnedSubtitleIndex,
      streamOffset,
    ]);

    // Handle video metadata loaded
    const handleLoadedMetadata = useCallback(() => {
      console.log("🎬 Video: Metadata loaded, setting start time");

      if (ref && "current" in ref && ref.current) {
        const { needsResumeSeek, startTime } = applyResumeSeekOnMetadata(
          ref.current,
        );

        updatePlaybackState({
          duration: ref.current.duration,
          canPlay: true,
          isLoading: needsResumeSeek,
        });

        if (needsResumeSeek) {
          console.log(`🎬 Video: Setting start time to ${startTime}s`);
        }

        console.log(
          `🎬 Video: Synchronizing volume (${volume}) and mute state (${isMuted})`,
        );
        ref.current.volume = volume;
        ref.current.muted = isMuted;
        ref.current.playbackRate = playbackRate;
      }
    }, [
      applyResumeSeekOnMetadata,
      ref,
      updatePlaybackState,
      volume,
      isMuted,
      playbackRate,
    ]);

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
      if (hasPendingResume()) return;

      updatePlaybackState({
        isBuffering: false,
        canPlay: true,
        isLoading: false,
      });
    }, [hasPendingResume, updatePlaybackState]);

    const handleLoadStart = useCallback(() => {
      captureResumeTimeOnLoadStart();

      updatePlaybackState({
        isLoading: true,
        error: null,
        canPlay: false,
      });
    }, [captureResumeTimeOnLoadStart, updatePlaybackState]);

    const handleLoadedData = useCallback(() => {
      if (hasPendingResume()) return;

      updatePlaybackState({
        isLoading: false,
        canPlay: true,
      });
    }, [hasPendingResume, updatePlaybackState]);

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

    const spawnSeekPulse = useCallback(
      (direction: DoubleClickSeekDirection) => {
        seekPulseIdRef.current += 1;
        const id = seekPulseIdRef.current;
        setSeekPulses((prev) => [...prev, { direction, id }]);
        const timeout = setTimeout(() => {
          setSeekPulses((prev) => prev.filter((p) => p.id !== id));
          seekPulseTimeoutsRef.current.delete(id);
        }, DOUBLE_CLICK_SEEK_PULSE_MS);
        seekPulseTimeoutsRef.current.set(id, timeout);
      },
      [],
    );

    const clearSeekPulses = useCallback(() => {
      for (const timeout of seekPulseTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      seekPulseTimeoutsRef.current.clear();
      setSeekPulses([]);
    }, []);

    const presentSeek = useCallback(
      (direction: DoubleClickSeekDirection) => {
        const video = videoElementRef.current;
        const before = video?.currentTime ?? 0;
        const duration = Number.isFinite(video?.duration)
          ? (video?.duration ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY;
        const canAccumulate =
          direction === "forward"
            ? duration - before > DOUBLE_CLICK_SEEK_SECONDS
            : before > DOUBLE_CLICK_SEEK_SECONDS;

        showSeekOverlay(direction, DOUBLE_CLICK_SEEK_SECONDS, canAccumulate);
        spawnSeekPulse(direction);
      },
      [showSeekOverlay, spawnSeekPulse],
    );

    useImperativeHandle(
      seekFeedbackRef,
      () => ({
        show: showSeekOverlay,
        presentSeek,
      }),
      [presentSeek, showSeekOverlay],
    );

    const handleVideoDoubleClick = useCallback(
      (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        if (useMobileSurfaceGestures) return;
        onVideoDoubleClick?.();
      },
      [onVideoDoubleClick, useMobileSurfaceGestures],
    );

    const {
      pointerHandlers: pressPointerHandlers,
      onClick: handleVideoClick,
      isHolding: isHoldingFastForward,
    } = useVideoPressGesture({
      videoRef: videoElementRef,
      holdRate: HOLD_PLAYBACK_RATE,
      holdActivationMs: HOLD_CLICK_SUPPRESSION_MS,
      dragTolerancePx: POINTER_DRAG_TOLERANCE_PX,
      onTap: useMobileSurfaceGestures ? onMobileSurfaceTap : undefined,
      onClick: useMobileSurfaceGestures ? undefined : onVideoClick,
    });

    const videoRefCallback = useCallback(
      (node: HTMLVideoElement | null) => {
        videoElementRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    useEffect(() => {
      if (!videoElementRef.current) return;
      videoElementRef.current.playbackRate = playbackRate;
    }, [playbackRate]);

    // Wheel-to-volume on desktop. The listener lives on the surface div (not
    // the <video>, which has `pointer-events: none` to let the surface own
    // pointer interactions). Attached imperatively because React's onWheel
    // is passive and we need preventDefault to stop the modal-less Dialog
    // from scrolling the page underneath.
    useEffect(() => {
      const node = surfaceElementRef.current;
      if (!node || !onVolumeScroll) return;

      const handler = (event: WheelEvent) => {
        event.preventDefault();
        // Invert deltaY so scrolling up raises the volume.
        onVolumeScroll(-event.deltaY);
      };

      node.addEventListener("wheel", handler, { passive: false });
      return () => node.removeEventListener("wheel", handler);
    }, [onVolumeScroll]);

    useEffect(() => {
      return () => {
        clearSeekOverlayTimeout();
        clearSeekPulses();
      };
    }, [clearSeekOverlayTimeout, clearSeekPulses]);

    /**
     * Handle video load error
     */
    const handleVideoError = useCallback(() => {
      if (ref && "current" in ref && ref.current?.error) {
        if (usesOffsetTimeline) {
          console.warn(
            "Transcoded stream failed at offset; retrying from beginning",
          );
          updatePlaybackState({
            streamOffset: 0,
            currentTime: 0,
            error: null,
            isLoading: true,
            isBuffering: false,
          });
          return;
        }

        const errorMessage = getVideoElementError(ref.current.error);
        updatePlaybackState({
          error: errorMessage,
          isLoading: false,
          isBuffering: false,
        });
      }
    }, [ref, updatePlaybackState, usesOffsetTimeline]);

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
        ref={surfaceRef}
        className={`touch-action-none relative h-full w-full cursor-pointer overflow-hidden bg-black select-none [-webkit-touch-callout:none] ${className}`}
        {...pressPointerHandlers}
        // Only suppress the context menu on mobile, where it's triggered by
        // the OS long-press during hold-to-fast-forward. Desktop users
        // should still get a normal right-click menu.
        onContextMenu={
          useMobileSurfaceGestures
            ? (event) => event.preventDefault()
            : undefined
        }
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
      >
        <video
          ref={videoRefCallback}
          autoPlay
          src={videoSrc}
          className="pointer-events-none h-full w-full object-contain"
          onError={handleVideoError}
          onLoadStart={handleLoadStart}
          onLoadedData={handleLoadedData}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onCanPlayThrough={handleCanPlayThrough}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onTimeUpdate={handleResumeTimeUpdate}
          onSeeking={handleSeeking}
          onSeeked={handleResumeSeeked}
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
        >
          {plexSubtitleTrackSrc && (
            <track
              key={plexSubtitleTrackSrc}
              kind="subtitles"
              src={plexSubtitleTrackSrc}
              label="Multiplex Plex"
              onLoad={handlePlexTrackLoad}
              default
            />
          )}
        </video>

        {isHoldingFastForward && (
          <div
            className="pointer-events-none absolute top-6 left-1/2 z-50 -translate-x-1/2"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-white shadow-lg ring-1 ring-white/20">
              <span className="text-sm font-semibold">
                {HOLD_PLAYBACK_RATE}x
              </span>
              <FastForward
                className="h-4 w-4 fill-white"
                strokeWidth={0}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        {seekPulses.map((pulse) => (
          <div
            key={pulse.id}
            className={cn(
              "pointer-events-none absolute top-0 bottom-0 z-50 flex w-1/2 items-center",
              pulse.direction === "forward"
                ? "right-0 justify-end pr-16"
                : "left-0 justify-start pl-16",
            )}
            aria-hidden="true"
          >
            <div
              className={cn(
                "fill-mode-[forwards] repeat-[1] absolute top-1/2 h-72 w-72 -translate-y-1/2 animate-ping rounded-full bg-white/20",
                pulse.direction === "forward" ? "-right-36" : "-left-36",
              )}
            />
          </div>
        ))}

        <MediaPlayerCaptionsOverlay
          lines={activeCaptions}
          controlsVisible={showControls}
          compactControls={useMobileSurfaceGestures}
          captionSize={captionSize}
        />

        <MediaPlayerSeekOverlay overlay={seekOverlay} />
      </div>
    );
  },
);

MediaPlayerVideo.displayName = "MediaPlayerVideo";

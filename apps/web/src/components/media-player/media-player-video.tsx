"use client";

import { FastForward } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ForwardedRef, MouseEvent, PointerEvent, RefObject } from "react";
import { cn } from "~/lib/utils";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import type {
  PlayerPlaybackIdentity,
  PlayerPlaybackUpdate,
} from "~/lib/effect/player-service";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type { MediaPlayerItem } from "~/types/media-player";
import { shallow } from "zustand/shallow";
import { useCaptionLines } from "./hooks/use-caption-lines";
import { usePlexSubtitleTrack } from "./hooks/use-plex-subtitle-track";
import { useResumePlayback } from "./hooks/use-resume-playback";
import { useSeekOverlay } from "./hooks/use-seek-overlay";
import { buildPlexPlaybackPlan } from "./utils/plex-playback-plan";
import { shouldClaimDirectSyncplaySeek } from "./utils/syncplay-seek-origin";
import {
  getTranscodeRetryDelayMs,
  getVideoElementError,
  isCurrentMediaSource,
  shouldRemainLoadingAfterMetadata,
  shouldReportVideoPause,
} from "./utils/media-player-utils";
import { getFullTimelineDuration } from "./utils/playback-time-utils";
import { generatePlexStreamUrl } from "./utils/plex-stream-urls";
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
const MAX_TRANSCODE_START_ATTEMPTS = 5;

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
   * True while a Watch Together session is driving this item. Disables the
   * hold-for-2x gesture and forces normal (1x) playback, since an independent
   * local playback rate can't be synced through Plex's syncplay server and
   * would only desync viewers.
   */
  isWatchTogetherActive?: boolean;
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
  /** Consumes an explicit pause requested through the player actions. */
  consumePauseRequest?: () => boolean;
  /**
   * Callback fired when video time updates
   */
  onVideoTimeUpdate?: (currentTime: number) => void;
  /**
   * Callback fired when a direct-play seek starts
   */
  onVideoSeeking?: (currentTime: number) => void;
  /**
   * Callback fired when video seeking is complete
   */
  onVideoSeeked?: (currentTime: number) => void;
}

function useMediaPlayerVideoController(
  {
    item,
    onVideoClick,
    onVideoDoubleClick,
    onMobileSurfaceTap,
    useMobileSurfaceGestures = false,
    isWatchTogetherActive = false,
    seekFeedbackRef,
    onVolumeScroll,
    onVideoEnded,
    onVideoPlay,
    onVideoPause,
    consumePauseRequest,
    onVideoTimeUpdate,
    onVideoSeeking,
    onVideoSeeked,
  }: MediaPlayerVideoProps,
  ref: ForwardedRef<HTMLVideoElement>,
) {
  const {
    streamOffset,
    streamSessionId,
    transcodeSessionId,
    transcodeAttempt,
    sourceGeneration,
    isLoading,
    showControls,
  } = usePlayerStateSelector(
    (state) => ({
      streamOffset: state.streamOffset,
      streamSessionId: state.streamSessionId,
      transcodeSessionId: state.transcodeSessionId,
      transcodeAttempt: state.transcodeAttempt,
      sourceGeneration: state.sourceGeneration,
      isLoading: state.isLoading,
      showControls: state.showControls,
    }),
    shallow,
  );
  const volume = usePlayerPrefsStore((state) => state.volume);
  const isMuted = usePlayerPrefsStore((state) => state.isMuted);
  const playbackRate = usePlayerPrefsStore((state) => state.playbackRate);
  const captionSize = usePlayerPrefsStore((state) => state.captionSize);
  const playbackIdentity: PlayerPlaybackIdentity = {
    streamSessionId,
    serverId: item.serverId,
    ratingKey: item.ratingKey,
  };
  const isCurrentSource = () => {
    const current = playerCommands.snapshot();
    return (
      current.sourceGeneration === sourceGeneration &&
      current.streamSessionId === playbackIdentity.streamSessionId &&
      current.currentItem?.serverId === playbackIdentity.serverId &&
      current.currentItem.ratingKey === playbackIdentity.ratingKey
    );
  };
  const updatePlaybackState = (updates: PlayerPlaybackUpdate) =>
    isCurrentSource() &&
    playerCommands.updatePlaybackStateFor(playbackIdentity, updates);
  const playbackPlan = buildPlexPlaybackPlan(item);
  const usesOffsetTimeline = streamOffset > 0;
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const surfaceElementRef = useRef<HTMLDivElement | null>(null);
  const isDocumentUnloadingRef = useRef(false);
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
    playbackGeneration: playbackIdentity.streamSessionId,
    sourceGeneration,
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
  const transcodeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const longPressRef = useSuppressNativeLongPress(useMobileSurfaceGestures);

  useEffect(() => {
    const markDocumentUnloading = () => {
      isDocumentUnloadingRef.current = true;
    };
    const markDocumentActive = () => {
      isDocumentUnloadingRef.current = false;
    };

    window.addEventListener("beforeunload", markDocumentUnloading);
    window.addEventListener("pagehide", markDocumentUnloading);
    window.addEventListener("pageshow", markDocumentActive);
    return () => {
      window.removeEventListener("beforeunload", markDocumentUnloading);
      window.removeEventListener("pagehide", markDocumentUnloading);
      window.removeEventListener("pageshow", markDocumentActive);
    };
  }, []);

  // Combined ref: forwards the surface element to both the long-press
  // suppression hook and our local ref (used for the non-passive wheel
  // listener below).
  const surfaceRef = (node: HTMLDivElement | null) => {
    longPressRef(node);
    surfaceElementRef.current = node;
  };

  const ratingKey = item.ratingKey;
  const metadataKey = item.key;
  const serverUrl = item.serverUrl;
  const authToken = item.authToken;
  const media = item.Media?.[0];
  const partKey = media?.Part?.[0]?.key;
  const videoCodec = media?.videoCodec;
  const audioCodec = media?.audioCodec;
  const container = media?.container;

  // Derive video source URL and error state from item. `streamOffset` only
  // affects transcoded streams, where it gets baked into the URL so the
  // transcoder restarts at the requested position. URL-affecting fields are
  // listed explicitly so stream-only metadata hydration does not reload video.
  const { videoSrc, hasError } = (() => {
    if (!partKey || !serverUrl || !authToken) {
      return { videoSrc: "", hasError: true };
    }

    const streamItem = {
      ratingKey,
      key: metadataKey,
      serverUrl,
      authToken,
      Media: [
        {
          videoCodec,
          audioCodec,
          container,
          Part: [{ key: partKey }],
        },
      ],
    } as MediaPlayerItem;

    try {
      const streamUrl = generatePlexStreamUrl(
        streamItem,
        serverUrl,
        authToken,
        playbackPlan,
        streamOffset,
        streamSessionId,
        transcodeAttempt,
        transcodeSessionId,
      );
      return { videoSrc: streamUrl, hasError: false };
    } catch (error) {
      console.error(
        "Failed to generate stream URL:",
        error instanceof Error ? error.message : error,
      );
      return { videoSrc: "", hasError: true };
    }
  })();

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    if (!isCurrentSource()) return;

    console.log("🎬 Video: Metadata loaded, setting start time");

    if (ref && "current" in ref && ref.current) {
      const { needsResumeSeek, startTime } = applyResumeSeekOnMetadata(
        ref.current,
      );

      updatePlaybackState({
        duration: getFullTimelineDuration({
          mediaElementDuration: ref.current.duration,
          itemDurationMs: item.duration,
          streamOffset: usesOffsetTimeline ? streamOffset : 0,
        }),
        // Metadata is enough to finish ordinary source loading, but not enough
        // to declare Syncplay readiness. `loadeddata` promotes `canPlay` once
        // the browser has actual media data; resume seeks stay loading until
        // their target is applied.
        canPlay: false,
        isLoading: shouldRemainLoadingAfterMetadata({
          needsResumeSeek,
          videoUsesTranscode: playbackPlan.videoUsesTranscode,
        }),
      });

      if (needsResumeSeek) {
        console.log(`🎬 Video: Setting start time to ${startTime}s`);
      }

      console.log(
        `🎬 Video: Synchronizing volume (${volume}) and mute state (${isMuted})`,
      );
      ref.current.volume = volume;
      ref.current.muted = isMuted;
      ref.current.playbackRate = isWatchTogetherActive ? 1 : playbackRate;
    }
  };

  // Handle video play event
  const handlePlay = () => {
    if (updatePlaybackState({ isPlaying: true })) onVideoPlay?.();
  };

  // Handle video pause event
  const handlePause = () => {
    const video = videoElementRef.current;
    if (!updatePlaybackState({ isPlaying: false }) || !video) return;
    const wasPauseRequested = consumePauseRequest?.() ?? true;
    if (
      shouldReportVideoPause({
        hasMediaError: video.error !== null,
        isDocumentUnloading: isDocumentUnloadingRef.current,
        isSourceLoading: isLoading,
        isCurrentMediaSource: isCurrentMediaSource(video.currentSrc, videoSrc),
        readyState: video.readyState,
        wasPauseRequested,
      })
    ) {
      onVideoPause?.();
    }
  };

  // Handle video ended event
  const handleEnded = () => {
    if (updatePlaybackState({ isPlaying: false })) onVideoEnded?.();
  };

  // Handle seeking event
  const handleSeeking = () => {
    if (!updatePlaybackState({ isBuffering: true })) return;

    // Claim direct-play seeks before Syncplay can reapply the old room
    // position while the browser is still fetching the target byte range.
    if (
      shouldClaimDirectSyncplaySeek({
        usesOffsetTimeline,
        hasPendingResume: hasPendingResume(),
      }) &&
      videoElementRef.current
    ) {
      onVideoSeeking?.(videoElementRef.current.currentTime);
    }
  };

  // Handle waiting event (buffering starts)
  const handleWaiting = () => {
    updatePlaybackState({ isBuffering: true });
  };

  // Handle can play event (buffering ends)
  const handleCanPlay = () => {
    updatePlaybackState({ isBuffering: false, canPlay: true });
  };

  // Handle can play through event
  const handleCanPlayThrough = () => {
    if (hasPendingResume()) return;

    updatePlaybackState({
      isBuffering: false,
      canPlay: true,
      isLoading: false,
    });
  };

  const handleLoadStart = () => {
    captureResumeTimeOnLoadStart();

    updatePlaybackState({
      isLoading: true,
      error: null,
      canPlay: false,
    });
  };

  const handleLoadedData = () => {
    if (hasPendingResume()) return;

    updatePlaybackState({
      isLoading: false,
      canPlay: true,
    });
  };

  // Handle progress event (buffering progress)
  const handleProgress = () => {
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
  };

  // Handle duration change event
  const handleDurationChange = () => {
    if (ref && "current" in ref && ref.current) {
      updatePlaybackState({
        duration: getFullTimelineDuration({
          mediaElementDuration: ref.current.duration,
          itemDurationMs: item.duration,
          streamOffset: usesOffsetTimeline ? streamOffset : 0,
        }),
      });
    }
  };

  // Handle volume change event
  const handleVolumeChange = () => {
    if (ref && "current" in ref && ref.current) {
      // Volume / mute live in the persisted prefs store, not PlayerService.
      usePlayerPrefsStore.setState({
        volume: ref.current.volume,
        isMuted: ref.current.muted,
      });
    }
  };

  // Handle stalled event
  const handleStalled = () => {
    updatePlaybackState({ isBuffering: true });
  };

  // Handle suspend event
  const handleSuspend = () => {
    updatePlaybackState({ isBuffering: false });
  };

  useImperativeHandle(
    seekFeedbackRef,
    () => ({
      show: showSeekOverlay,
      presentSeek: (direction: DoubleClickSeekDirection) => {
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

        seekPulseIdRef.current += 1;
        const id = seekPulseIdRef.current;
        setSeekPulses((prev) => [...prev, { direction, id }]);
        const timeout = setTimeout(() => {
          setSeekPulses((prev) => prev.filter((pulse) => pulse.id !== id));
          seekPulseTimeoutsRef.current.delete(id);
        }, DOUBLE_CLICK_SEEK_PULSE_MS);
        seekPulseTimeoutsRef.current.set(id, timeout);
      },
    }),
    [showSeekOverlay],
  );

  const handleVideoDoubleClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (useMobileSurfaceGestures) return;
    onVideoDoubleClick?.();
  };

  const {
    pointerHandlers: pressPointerHandlers,
    onClick: handleVideoClick,
    isHolding: isHoldingFastForward,
  } = useVideoPressGesture({
    videoRef: videoElementRef,
    holdRate: HOLD_PLAYBACK_RATE,
    holdActivationMs: HOLD_CLICK_SUPPRESSION_MS,
    dragTolerancePx: POINTER_DRAG_TOLERANCE_PX,
    holdEnabled: !isWatchTogetherActive,
    onTap: useMobileSurfaceGestures ? onMobileSurfaceTap : undefined,
    onClick: useMobileSurfaceGestures ? undefined : onVideoClick,
  });

  const videoRefCallback = (node: HTMLVideoElement | null) => {
    if (videoElementRef.current === node) return;
    videoElementRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
    // Start from the imperative play() path instead of the autoPlay attribute
    // so audible playback stays under player/Syncplay control.
    if (node) {
      void node.play().catch(() => {
        // Autoplay can still be blocked by the browser; controls retry.
      });
    }
  };

  // A Watch Together session forces normal speed (an unsynced local rate would
  // desync viewers); otherwise honor the user's chosen rate.
  useEffect(() => {
    if (!videoElementRef.current) return;
    videoElementRef.current.playbackRate = isWatchTogetherActive
      ? 1
      : playbackRate;
  }, [playbackRate, isWatchTogetherActive]);

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
    const pulseTimeouts = seekPulseTimeoutsRef.current;

    return () => {
      clearSeekOverlayTimeout();
      for (const timeout of pulseTimeouts.values()) {
        clearTimeout(timeout);
      }
      pulseTimeouts.clear();
    };
  }, [clearSeekOverlayTimeout]);

  /**
   * Handle video load error
   */
  const handleVideoError = () => {
    if (ref && "current" in ref && ref.current?.error) {
      if (!isCurrentMediaSource(ref.current.currentSrc, videoSrc)) return;
      // Detaching the old source can deliver a late error event. It belongs
      // to the source being replaced and must not restart that transcode.
      if (playerCommands.snapshot().isPreparingReplacement) return;
      if (
        playbackPlan.videoUsesTranscode &&
        transcodeAttempt + 1 < MAX_TRANSCODE_START_ATTEMPTS &&
        isCurrentSource()
      ) {
        if (transcodeRetryTimeoutRef.current !== null) return;
        const delayMs = getTranscodeRetryDelayMs(transcodeAttempt);
        updatePlaybackState({
          isLoading: true,
          isBuffering: false,
          canPlay: false,
          error: null,
        });
        console.warn(
          `Plex transcode start failed; retrying with a fresh session in ${delayMs}ms (${transcodeAttempt + 2}/${MAX_TRANSCODE_START_ATTEMPTS})`,
        );
        transcodeRetryTimeoutRef.current = setTimeout(() => {
          transcodeRetryTimeoutRef.current = null;
          const video = videoElementRef.current;
          if (
            video &&
            isCurrentSource() &&
            isCurrentMediaSource(video.currentSrc, videoSrc)
          ) {
            playerCommands.retryTranscodeSource(playbackIdentity);
          }
        }, delayMs);
        return;
      }

      if (usesOffsetTimeline) {
        const errorMessage =
          "Plex could not start playback at this position. Try seeking slightly earlier.";
        console.warn(errorMessage);
        updatePlaybackState({
          error: errorMessage,
          isLoading: false,
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
  };

  useEffect(() => {
    return () => {
      if (transcodeRetryTimeoutRef.current !== null) {
        clearTimeout(transcodeRetryTimeoutRef.current);
        transcodeRetryTimeoutRef.current = null;
      }
    };
  }, [videoSrc]);

  return {
    activeCaptions,
    captionSize,
    handleCanPlay,
    handleCanPlayThrough,
    handleDurationChange,
    handleEnded,
    handleLoadStart,
    handleLoadedData,
    handleLoadedMetadata,
    handlePause,
    handlePlay,
    handlePlexTrackLoad,
    handleProgress,
    handleResumeSeeked,
    handleResumeTimeUpdate,
    handleSeeking,
    handleStalled,
    handleSuspend,
    handleVideoClick,
    handleVideoDoubleClick,
    handleVideoError,
    handleVolumeChange,
    handleWaiting,
    hasError,
    isHoldingFastForward,
    plexSubtitleTrackSrc,
    pressPointerHandlers,
    seekOverlay,
    seekPulses,
    showControls,
    sourceGeneration,
    streamSessionId,
    surfaceRef,
    videoRefCallback,
    videoSrc,
  };
}

export const MediaPlayerVideo = forwardRef<
  HTMLVideoElement,
  MediaPlayerVideoProps
>((props, ref) => {
  const {
    className = "",
    onVideoClick,
    useMobileSurfaceGestures = false,
  } = props;
  const {
    activeCaptions,
    captionSize,
    handleCanPlay,
    handleCanPlayThrough,
    handleDurationChange,
    handleEnded,
    handleLoadStart,
    handleLoadedData,
    handleLoadedMetadata,
    handlePause,
    handlePlay,
    handlePlexTrackLoad,
    handleProgress,
    handleResumeSeeked,
    handleResumeTimeUpdate,
    handleSeeking,
    handleStalled,
    handleSuspend,
    handleVideoClick,
    handleVideoDoubleClick,
    handleVideoError,
    handleVolumeChange,
    handleWaiting,
    hasError,
    isHoldingFastForward,
    plexSubtitleTrackSrc,
    pressPointerHandlers,
    seekOverlay,
    seekPulses,
    showControls,
    sourceGeneration,
    streamSessionId,
    surfaceRef,
    videoRefCallback,
    videoSrc,
  } = useMediaPlayerVideoController(props, ref);

  if (hasError || !videoSrc) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-black ${className}`}
      >
        <div className="text-center text-white">
          <div className="mb-2 text-xl">⚠️</div>
          <div className="mb-1 text-lg font-semibold">Unable to load video</div>
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
      role="button"
      tabIndex={0}
      aria-label="Video playback surface"
      className={`touch-action-none relative h-full w-full cursor-pointer overflow-hidden bg-black select-none [-webkit-touch-callout:none] ${className}`}
      {...pressPointerHandlers}
      // Only suppress the context menu on mobile, where it's triggered by
      // the OS long-press during hold-to-fast-forward. Desktop users
      // should still get a normal right-click menu.
      onContextMenu={
        useMobileSurfaceGestures ? (event) => event.preventDefault() : undefined
      }
      onClick={handleVideoClick}
      onDoubleClick={handleVideoDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onVideoClick?.();
        }
      }}
    >
      <video
        key={`${streamSessionId}:${sourceGeneration}`}
        ref={videoRefCallback}
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
            <span className="text-sm font-semibold">{HOLD_PLAYBACK_RATE}x</span>
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
});

MediaPlayerVideo.displayName = "MediaPlayerVideo";

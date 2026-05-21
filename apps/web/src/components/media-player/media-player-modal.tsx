"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent,
} from "react";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  MediaPlayerDialogContent,
} from "~/components/ui/dialog";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMediaPlayer } from "./hooks/use-media-player";
import { usePlayQueue } from "./hooks/use-play-queue";
import { useTimelineUpdates } from "./hooks/use-timeline-updates";
import { useAutoPlayNextEpisode } from "./hooks/use-auto-play-next-episode";
import { useMobileVideoChrome } from "./hooks/use-mobile-video-chrome";
import type { MobileSeekZone } from "./hooks/use-mobile-video-chrome";
import { MediaPlayerCenterControls } from "./media-player-center-controls";
import { MediaPlayerControls } from "./media-player-controls";
import { MediaPlayerChromeFade } from "./media-player-chrome-fade";
import {
  MediaPlayerOverlay,
  MediaPlayerTitleChrome,
  mediaPlayerControlsTransition,
} from "./media-player-overlay";
import { MediaPlayerSkipOverlay } from "./media-player-skip-overlay";
import { MediaPlayerAutoPlayOverlay } from "./media-player-autoplay-overlay";
import { MediaPlayerVideo } from "./media-player-video";
import type { MediaPlayerSeekFeedbackHandle } from "./media-player-video";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using shadcn Dialog
   ──────────────────────────────────────────────────────────── */

const MOBILE_CONTROLS_HIDE_DELAY_MS = 3000;
const SEEK_SECONDS = 10;

export function MediaPlayerModal() {
  const isOpen = useMediaPlayerStore((state) => state.isOpen);
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const showControls = useMediaPlayerStore((state) => state.showControls);
  const markers = useMediaPlayerStore((state) => state.markers);
  const isLoading = useMediaPlayerStore((state) => state.isLoading);
  const error = useMediaPlayerStore((state) => state.error);
  const isPlaying = useMediaPlayerStore((state) => state.isPlaying);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const volume = useMediaPlayerStore((state) => state.volume);

  const { closePlayer, updatePlaybackState } = useMediaPlayerStore();
  const { actions, videoRef } = useMediaPlayer();
  const seekFeedbackRef = useRef<MediaPlayerSeekFeedbackHandle>(null);
  const isMobile = useIsMobile();

  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearAllTimeouts = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
      mouseMoveTimeoutRef.current = null;
    }
  }, []);

  const showControlsImmediate = useCallback(() => {
    clearAllTimeouts();
    updatePlaybackState({ showControls: true });
  }, [clearAllTimeouts, updatePlaybackState]);

  const hideControlsDelayed = useCallback(
    (delay = MOBILE_CONTROLS_HIDE_DELAY_MS) => {
      clearAllTimeouts();
      hideTimeoutRef.current = setTimeout(() => {
        updatePlaybackState({ showControls: false });
      }, delay);
    },
    [clearAllTimeouts, updatePlaybackState],
  );

  const hideControlsImmediate = useCallback(() => {
    clearAllTimeouts();
    updatePlaybackState({ showControls: false });
  }, [clearAllTimeouts, updatePlaybackState]);

  const handleMobileDoubleTapSeek = useCallback(
    (zone: MobileSeekZone) => {
      if (zone === "forward") {
        actions.skipForward(SEEK_SECONDS);
        seekFeedbackRef.current?.presentSeek("forward");
      } else {
        actions.skipBackward(SEEK_SECONDS);
        seekFeedbackRef.current?.presentSeek("backward");
      }
    },
    [actions],
  );

  const { handleSurfaceTap, resetAutoHide: resetMobileControlsTimer } =
    useMobileVideoChrome({
      showControls,
      showControlsImmediate,
      hideControlsImmediate,
      hideControlsDelayed,
      onDoubleTapSeek: handleMobileDoubleTapSeek,
    });

  const actionsWithSeekFeedback = useMemo(() => {
    const showSeekFeedback = (
      direction: "backward" | "forward",
      seconds: number,
      accumulate = true,
    ) => {
      if (!isMobile) {
        seekFeedbackRef.current?.show(direction, seconds, accumulate);
      }
    };

    return {
      ...actions,
      skipForward: (seconds = SEEK_SECONDS) => {
        const canAccumulate = duration - currentTime > seconds;
        actions.skipForward(seconds);
        showSeekFeedback("forward", seconds, canAccumulate);
      },
      skipBackward: (seconds = SEEK_SECONDS) => {
        const canAccumulate = currentTime > seconds;
        actions.skipBackward(seconds);
        showSeekFeedback("backward", seconds, canAccumulate);
      },
    };
  }, [actions, currentTime, duration, isMobile]);

  usePlayQueue(currentItem);
  const { autoPlayState } = useAutoPlayNextEpisode();

  const {
    onPlay,
    onPause,
    onTimeUpdate,
    onSeeked,
    onEnded,
    onStop,
    clearSession,
  } = useTimelineUpdates();

  const handleClose = useCallback(() => {
    onStop();
    clearSession();
    clearAllTimeouts();
    closePlayer();
  }, [onStop, clearSession, clearAllTimeouts, closePlayer]);

  const handleVideoClick = useCallback(() => {
    actions.togglePlay();
  }, [actions]);

  const handleVideoDoubleClick = useCallback(() => {
    actions.toggleFullscreen();
  }, [actions]);

  const handleVolumeScroll = useCallback(
    (delta: number) => {
      const volumeStep = 0.1;
      const newVolume = Math.max(
        0,
        Math.min(1, volume + (delta > 0 ? volumeStep : -volumeStep)),
      );
      actions.setVolume(newVolume);
    },
    [actions, volume],
  );

  const handleCenterTogglePlay = useCallback(() => {
    actions.togglePlay();
    resetMobileControlsTimer();
  }, [actions, resetMobileControlsTimer]);

  const handleMobileSkipBackward = useCallback(() => {
    actions.skipBackward(SEEK_SECONDS);
    seekFeedbackRef.current?.presentSeek("backward");
    resetMobileControlsTimer();
  }, [actions, resetMobileControlsTimer]);

  const handleMobileSkipForward = useCallback(() => {
    actions.skipForward(SEEK_SECONDS);
    seekFeedbackRef.current?.presentSeek("forward");
    resetMobileControlsTimer();
  }, [actions, resetMobileControlsTimer]);

  const stopOverlayPointer = useCallback((event: PointerEvent) => {
    event.stopPropagation();
  }, []);

  const handleMouseEnter = useCallback(() => {
    showControlsImmediate();
  }, [showControlsImmediate]);

  const handleMouseLeave = useCallback(() => {
    hideControlsDelayed(1000);
  }, [hideControlsDelayed]);

  const handleMouseMove = useCallback(() => {
    showControlsImmediate();
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
    }
    mouseMoveTimeoutRef.current = setTimeout(() => {
      hideControlsDelayed(0);
    }, 3000);
  }, [showControlsImmediate, hideControlsDelayed]);

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    hideControlsDelayed(MOBILE_CONTROLS_HIDE_DELAY_MS);
    return clearAllTimeouts;
  }, [isOpen, isMobile, hideControlsDelayed, clearAllTimeouts]);

  useKeyboardShortcuts({
    isOpen,
    actions: actionsWithSeekFeedback,
    currentTime,
    duration,
    volume,
  });

  const chromeClassName = isMobile
    ? undefined
    : cn(
        mediaPlayerControlsTransition.base,
        showControls
          ? cn(mediaPlayerControlsTransition.visible, "pointer-events-auto")
          : cn(
              mediaPlayerControlsTransition.hidden,
              "group-hover:pointer-events-auto group-hover:opacity-100",
            ),
      );

  if (!currentItem) return null;

  return (
    <Dialog modal={false} open={isOpen} onOpenChange={handleClose}>
      <MediaPlayerDialogContent>
        <DialogTitle className="sr-only">
          Media Player - {currentItem.title}
        </DialogTitle>

        <DialogDescription className="sr-only">
          Playing {currentItem.title}. Use spacebar to play/pause, arrow keys to
          seek, and escape to close.
        </DialogDescription>

        <div
          className={`group cursor-none overflow-visible hover:cursor-default ${
            isMobile
              ? "fixed inset-0 flex items-center justify-center"
              : "relative h-full w-full overflow-hidden"
          }`}
          onMouseEnter={isMobile ? undefined : handleMouseEnter}
          onMouseLeave={isMobile ? undefined : handleMouseLeave}
          onMouseMove={isMobile ? undefined : handleMouseMove}
        >
          <div
            className={`group relative cursor-none overflow-hidden hover:cursor-default ${
              isMobile ? "origin-center rotate-90" : "h-full w-full"
            }`}
            style={
              isMobile
                ? {
                    width: "100svh",
                    height: "100svw",
                    minWidth: "100svh",
                    minHeight: "100svw",
                  }
                : {}
            }
          >
            {!isMobile && (
              <div
                className={cn("absolute top-4 right-4 z-50", chromeClassName)}
                onPointerDown={stopOverlayPointer}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="text-white hover:bg-white/20"
                >
                  <X className="h-6 w-6" />
                </Button>
              </div>
            )}

            <div className="relative h-full w-full">
              <MediaPlayerVideo
                ref={videoRef}
                seekFeedbackRef={seekFeedbackRef}
                item={currentItem}
                className="h-full w-full"
                useMobileSurfaceGestures={isMobile}
                onMobileSurfaceTap={isMobile ? handleSurfaceTap : undefined}
                onVideoClick={isMobile ? undefined : handleVideoClick}
                onVideoDoubleClick={handleVideoDoubleClick}
                onVolumeScroll={handleVolumeScroll}
                onVideoEnded={onEnded}
                onVideoPlay={onPlay}
                onVideoPause={onPause}
                onVideoTimeUpdate={onTimeUpdate}
                onVideoSeeked={onSeeked}
              />

              <MediaPlayerOverlay
                item={currentItem}
                isVisible={showControls}
                isLoading={isLoading}
                error={error}
                showTitle={!isMobile}
              />

              <MediaPlayerSkipOverlay
                markers={markers}
                currentTime={currentTime}
                onSkip={actions.seekToMarkerEnd}
              />

              <MediaPlayerAutoPlayOverlay
                isCountingDown={autoPlayState.isCountingDown}
                countdownSeconds={autoPlayState.countdownSeconds}
                nextEpisode={autoPlayState.nextEpisode}
              />

              {isMobile ? (
                <MediaPlayerChromeFade
                  visible={showControls}
                  className="absolute inset-0 z-30"
                >
                  <MediaPlayerTitleChrome item={currentItem} />

                  <div
                    className="pointer-events-auto absolute top-4 right-4 z-50"
                    onPointerDown={stopOverlayPointer}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClose}
                      className="text-white hover:bg-white/20"
                    >
                      <X className="h-6 w-6" />
                    </Button>
                  </div>

                  <MediaPlayerCenterControls
                    isVisible
                    isPlaying={isPlaying}
                    disabled={!canPlay}
                    onTogglePlay={handleCenterTogglePlay}
                    onSkipBackward={handleMobileSkipBackward}
                    onSkipForward={handleMobileSkipForward}
                  />

                  <div
                    className="pointer-events-auto absolute right-0 bottom-0 left-0 z-30"
                    onPointerDown={(event) => {
                      stopOverlayPointer(event);
                      resetMobileControlsTimer();
                    }}
                  >
                    <MediaPlayerControls
                      isVisible
                      actions={actions}
                      progressOnly
                      className="px-4 py-2"
                    />
                  </div>
                </MediaPlayerChromeFade>
              ) : (
                <div
                  className={cn(
                    "absolute right-0 bottom-0 left-0 z-30",
                    chromeClassName,
                  )}
                  onPointerDown={stopOverlayPointer}
                >
                  <MediaPlayerControls
                    isVisible
                    actions={actions}
                    progressOnly={false}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </MediaPlayerDialogContent>
    </Dialog>
  );
}

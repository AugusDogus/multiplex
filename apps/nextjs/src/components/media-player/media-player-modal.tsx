"use client";

import { X } from "lucide-react";
import { useCallback, useRef } from "react";
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
import { MediaPlayerControls } from "./media-player-controls";
import { MediaPlayerOverlay } from "./media-player-overlay";
import { MediaPlayerSkipOverlay } from "./media-player-skip-overlay";
import { MediaPlayerAutoPlayOverlay } from "./media-player-autoplay-overlay";
import { MediaPlayerVideo } from "./media-player-video";
import { useIsMobile } from "~/hooks/use-mobile";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using shadcn Dialog
   ──────────────────────────────────────────────────────────── */

export function MediaPlayerModal() {
  const isOpen = useMediaPlayerStore((state) => state.isOpen);
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const showControls = useMediaPlayerStore((state) => state.showControls);
  const markers = useMediaPlayerStore((state) => state.markers);
  const isLoading = useMediaPlayerStore((state) => state.isLoading);
  const error = useMediaPlayerStore((state) => state.error);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const volume = useMediaPlayerStore((state) => state.volume);

  const { closePlayer, updatePlaybackState } = useMediaPlayerStore();
  const { actions, videoRef } = useMediaPlayer();
  const isMobile = useIsMobile();

  // Initialize play queue for marker support
  usePlayQueue(currentItem);

  // Auto-play next episode functionality
  const { autoPlayState } = useAutoPlayNextEpisode();

  // Timeline updates hook - sends progress updates to Plex server
  const {
    onPlay,
    onPause,
    onTimeUpdate,
    onSeeked,
    onEnded,
    onStop,
    clearSession,
  } = useTimelineUpdates();

  // Use refs to track timeouts and avoid race conditions
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear all timeouts
   */
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

  /**
   * Show controls immediately
   */
  const showControlsImmediate = useCallback(() => {
    clearAllTimeouts();
    updatePlaybackState({ showControls: true });
  }, [clearAllTimeouts, updatePlaybackState]);

  /**
   * Hide controls after delay
   */
  const hideControlsDelayed = useCallback(
    (delay = 3000) => {
      clearAllTimeouts();
      hideTimeoutRef.current = setTimeout(() => {
        updatePlaybackState({ showControls: false });
      }, delay);
    },
    [clearAllTimeouts, updatePlaybackState],
  );

  /**
   * Handle modal close
   */
  const handleClose = useCallback(() => {
    // Send stop update with current time (not duration) before closing
    onStop();
    clearSession();
    clearAllTimeouts();
    closePlayer();
  }, [onStop, clearSession, clearAllTimeouts, closePlayer]);

  /**
   * Handle video click for play/pause toggle
   */
  const handleVideoClick = useCallback(() => {
    actions.togglePlay();
  }, [actions]);

  /**
   * Handle video double-click for fullscreen toggle
   */
  const handleVideoDoubleClick = useCallback(() => {
    actions.toggleFullscreen();
  }, [actions]);

  /**
   * Handle volume scroll on video
   */
  const handleVolumeScroll = useCallback(
    (delta: number) => {
      const volumeStep = 0.1; // 10% volume change per scroll step (matches keyboard shortcuts)
      const newVolume = Math.max(
        0,
        Math.min(1, volume + (delta > 0 ? volumeStep : -volumeStep)),
      );
      actions.setVolume(newVolume);
    },
    [actions, volume],
  );

  // Note: Video ended is handled by onEnded callback passed to MediaPlayerVideo
  // Could implement auto-next episode or other logic here in the future

  /**
   * Handle mouse enter - show controls
   */
  const handleMouseEnter = useCallback(() => {
    showControlsImmediate();
  }, [showControlsImmediate]);

  /**
   * Handle mouse leave - hide controls after short delay
   */
  const handleMouseLeave = useCallback(() => {
    hideControlsDelayed(1000);
  }, [hideControlsDelayed]);

  /**
   * Handle mouse move - show controls and reset hide timer
   */
  const handleMouseMove = useCallback(() => {
    showControlsImmediate();
    // Clear existing mouse move timeout
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
    }
    // Set new timeout for auto-hide
    mouseMoveTimeoutRef.current = setTimeout(() => {
      hideControlsDelayed(0); // Hide immediately when timeout fires
    }, 3000);
  }, [showControlsImmediate, hideControlsDelayed]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isOpen,
    actions,
    currentTime,
    duration,
    volume,
  });

  // Don't render if no current item
  if (!currentItem) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <MediaPlayerDialogContent>
        {/* Visually hidden title for accessibility */}
        <DialogTitle className="sr-only">
          Media Player - {currentItem.title}
        </DialogTitle>

        {/* Visually hidden description for accessibility */}
        <DialogDescription className="sr-only">
          Playing {currentItem.title}. Use spacebar to play/pause, arrow keys to
          seek, and escape to close.
        </DialogDescription>

        {/* Video Player Container - Full screen with overlaid controls */}
        <div
          className={`group cursor-none overflow-visible hover:cursor-default ${
            isMobile
              ? "fixed inset-0 flex items-center justify-center"
              : "relative h-full w-full overflow-hidden"
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
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
            {/* Close Button - Top right corner */}
            <div
              className={`absolute top-4 right-4 z-20 transition-opacity duration-300 group-hover:opacity-100 ${
                showControls
                  ? "opacity-100"
                  : "pointer-events-none opacity-0 group-hover:pointer-events-auto"
              }`}
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

            {/* Video Player Container */}
            <div className="relative h-full w-full">
              {/* Video Player - Takes up full space */}
              <MediaPlayerVideo
                ref={videoRef}
                item={currentItem}
                className="h-full w-full"
                onVideoClick={handleVideoClick}
                onVideoDoubleClick={handleVideoDoubleClick}
                onVolumeScroll={handleVolumeScroll}
                onVideoEnded={onEnded}
                onVideoPlay={onPlay}
                onVideoPause={onPause}
                onVideoTimeUpdate={onTimeUpdate}
                onVideoSeeked={onSeeked}
              />

              {/* Title and Metadata Overlay - Top of video */}
              <MediaPlayerOverlay
                item={currentItem}
                isVisible={showControls}
                isLoading={isLoading}
                error={error}
              />

              {/* Skip Intro/Credits Overlay - Always visible when applicable */}
              <MediaPlayerSkipOverlay
                markers={markers}
                currentTime={currentTime}
                onSkip={actions.seekToMarkerEnd}
              />

              {/* Auto Play Overlay - Shows countdown for next episode */}
              <MediaPlayerAutoPlayOverlay
                isCountingDown={autoPlayState.isCountingDown}
                countdownSeconds={autoPlayState.countdownSeconds}
                nextEpisode={autoPlayState.nextEpisode}
              />

              {/* Media Controls - Bottom overlay with fade transition */}
              <div
                className={`absolute right-0 bottom-0 left-0 transition-opacity duration-300 group-hover:opacity-100 ${
                  showControls
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 group-hover:pointer-events-auto"
                }`}
              >
                <MediaPlayerControls
                  isVisible={true} // Always render, just control opacity
                  actions={actions}
                />
              </div>
            </div>
          </div>
        </div>
      </MediaPlayerDialogContent>
    </Dialog>
  );
}

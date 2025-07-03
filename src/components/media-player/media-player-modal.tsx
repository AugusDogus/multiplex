"use client";

import { useAtom } from "jotai";
import { X } from "lucide-react";
import { useCallback, useRef } from "react";
import {
  closeMediaPlayerAtom,
  mediaPlayerStateAtom,
  updatePlaybackStateAtom,
} from "~/atoms/media-player";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  MediaPlayerDialogContent,
} from "~/components/ui/dialog";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMediaPlayer } from "./hooks/use-media-player";
import { useTimelineUpdates } from "./hooks/use-timeline-updates";
import { MediaPlayerControls } from "./media-player-controls";
import { MediaPlayerOverlay } from "./media-player-overlay";
import { MediaPlayerVideo } from "./media-player-video";
import { useIsMobile } from "~/hooks/use-mobile";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using shadcn Dialog
   ──────────────────────────────────────────────────────────── */

export function MediaPlayerModal() {
  const [state] = useAtom(mediaPlayerStateAtom);
  const [, closePlayer] = useAtom(closeMediaPlayerAtom);
  const [, updateState] = useAtom(updatePlaybackStateAtom);
  const { actions, videoRef } = useMediaPlayer();
  const isMobile = useIsMobile();

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
  const showControls = useCallback(() => {
    clearAllTimeouts();
    updateState({ showControls: true });
  }, [clearAllTimeouts, updateState]);

  /**
   * Hide controls after delay
   */
  const hideControlsDelayed = useCallback(
    (delay = 3000) => {
      clearAllTimeouts();
      hideTimeoutRef.current = setTimeout(() => {
        updateState({ showControls: false });
      }, delay);
    },
    [clearAllTimeouts, updateState],
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
      const currentVolume = state.volume;
      const newVolume = Math.max(
        0,
        Math.min(1, currentVolume + (delta > 0 ? volumeStep : -volumeStep)),
      );
      actions.setVolume(newVolume);
    },
    [actions, state.volume],
  );

  /**
   * Handle video ended
   */
  const handleVideoEnded = useCallback(() => {
    // Timeline update is handled by onEnded callback
    // Could implement auto-next episode or other logic here
    console.log("Video ended");
  }, []);

  /**
   * Handle mouse enter - show controls
   */
  const handleMouseEnter = useCallback(() => {
    showControls();
  }, [showControls]);

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
    showControls();
    // Clear existing mouse move timeout
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
    }
    // Set new timeout for auto-hide
    mouseMoveTimeoutRef.current = setTimeout(() => {
      hideControlsDelayed(0); // Hide immediately when timeout fires
    }, 3000);
  }, [showControls, hideControlsDelayed]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isOpen: state.isOpen,
    actions,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: state.volume,
  });

  // Don't render if no current item
  if (!state.currentItem) return null;

  return (
    <Dialog open={state.isOpen} onOpenChange={handleClose}>
      <MediaPlayerDialogContent>
        {/* Visually hidden title for accessibility */}
        <DialogTitle className="sr-only">
          Media Player - {state.currentItem.title}
        </DialogTitle>

        {/* Visually hidden description for accessibility */}
        <DialogDescription className="sr-only">
          Playing {state.currentItem.title}. Use spacebar to play/pause, arrow
          keys to seek, and escape to close.
        </DialogDescription>

        {/* Video Player Container - Full screen with overlaid controls */}
        <div
          className={`group relative cursor-none overflow-hidden hover:cursor-default ${
            isMobile 
              ? "fixed inset-0 flex items-center justify-center" 
              : "h-full w-full"
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          {/* Close Button - Outside rotation on mobile, inside on desktop */}
          {!isMobile && (
            <div
              className={`absolute top-4 right-4 z-20 transition-opacity duration-300 group-hover:opacity-100 ${
                state.showControls
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
          )}

          {/* Mobile Close Button - Outside rotated container */}
          {isMobile && (
            <div className="absolute top-4 right-4 z-30">
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

          {/* Video Player Container - Rotated on mobile */}
          <div
            className={
              isMobile
                ? "h-[100vw] w-[100vh] origin-center rotate-90"
                : "relative h-full w-full"
            }
          >
            {/* Video Player - Takes up full space */}
            <MediaPlayerVideo
              ref={videoRef}
              item={state.currentItem}
              className="h-full w-full"
              objectFit={isMobile ? "cover" : "contain"}
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
              item={state.currentItem}
              isVisible={state.showControls}
              isLoading={state.isLoading}
              error={state.error}
            />

            {/* Media Controls - Bottom overlay with fade transition */}
            <div
              className={`absolute right-0 bottom-0 left-0 transition-opacity duration-300 group-hover:opacity-100 ${
                state.showControls
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
      </MediaPlayerDialogContent>
    </Dialog>
  );
}

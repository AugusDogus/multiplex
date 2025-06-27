"use client";

import { useAtom } from "jotai";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import {
  closeMediaPlayerAtom,
  mediaPlayerStateAtom,
  updatePlaybackStateAtom,
} from "~/atoms/media-player";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogTitle,
  MediaPlayerDialogContent,
} from "~/components/ui/dialog";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMediaPlayer } from "./hooks/use-media-player";
import { MediaPlayerControls } from "./media-player-controls";
import { MediaPlayerOverlay } from "./media-player-overlay";
import { MediaPlayerVideo } from "./media-player-video";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using shadcn Dialog
   ──────────────────────────────────────────────────────────── */

export function MediaPlayerModal() {
  const [state] = useAtom(mediaPlayerStateAtom);
  const [, closePlayer] = useAtom(closeMediaPlayerAtom);
  const [, updateState] = useAtom(updatePlaybackStateAtom);
  const { actions, videoRef } = useMediaPlayer();

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
    clearAllTimeouts();
    closePlayer();
  }, [clearAllTimeouts, closePlayer]);

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
   * Handle video ended
   */
  const handleVideoEnded = useCallback(() => {
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

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

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

        {/* Video Player Container - Full screen with overlaid controls */}
        <div
          className="group relative h-full w-full cursor-none overflow-hidden hover:cursor-default"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          {/* Close Button - Top right corner */}
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

          {/* Video Player - Takes up full space */}
          <MediaPlayerVideo
            ref={videoRef}
            item={state.currentItem}
            className="h-full w-full"
            onVideoClick={handleVideoClick}
            onVideoDoubleClick={handleVideoDoubleClick}
            onVideoEnded={handleVideoEnded}
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
      </MediaPlayerDialogContent>
    </Dialog>
  );
}

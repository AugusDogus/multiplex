"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  MediaPlayerDialogContent,
} from "~/components/ui/dialog";
import { useDragToDismiss } from "./hooks/use-drag-to-dismiss";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMediaPlayer } from "./hooks/use-media-player";
import { usePlayQueue } from "./hooks/use-play-queue";
import { useTimelineUpdates } from "./hooks/use-timeline-updates";
import { useAutoPlayNextEpisode } from "./hooks/use-auto-play-next-episode";
import { useWatchTogetherRotation } from "./hooks/use-watch-together-rotation";
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
import {
  stopPlaybackTranscodeSessions,
  stopTranscodeSession,
} from "./utils/plex-stream-urls";
import { useIsMobile } from "~/hooks/use-mobile";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { cn } from "~/lib/utils";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { shallow } from "zustand/shallow";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using shadcn Dialog
   ──────────────────────────────────────────────────────────── */

const MOBILE_CONTROLS_HIDE_DELAY_MS = 3000;
const SEEK_SECONDS = 10;

type ItemIdentity = {
  readonly serverId: string;
  readonly ratingKey: string;
};

type PlaybackGeneration = ItemIdentity & {
  readonly streamSessionId: string;
};

const itemsMatch = (left: ItemIdentity, right: ItemIdentity | null): boolean =>
  left.serverId === right?.serverId && left.ratingKey === right.ratingKey;

const isSessionControllingItem = (item: ItemIdentity): boolean => {
  const session = sessionCommands.snapshot();
  const currentItem = playerCommands.snapshot().currentItem;
  return (
    session._tag === "Playing" &&
    itemsMatch(session.item, item) &&
    itemsMatch(session.item, currentItem)
  );
};

const isSessionControllingPlayback = (
  playback: PlaybackGeneration,
): boolean => {
  const session = sessionCommands.snapshot();
  const player = playerCommands.snapshot();
  return (
    session._tag === "Playing" &&
    itemsMatch(session.item, playback) &&
    itemsMatch(playback, player.currentItem) &&
    player.streamSessionId === playback.streamSessionId
  );
};

export function MediaPlayerModal() {
  const {
    isOpen,
    currentItem,
    showControls,
    markers,
    isLoading,
    error,
    isPlaying,
    canPlay,
    currentTime,
    duration,
    streamOffset,
    streamSessionId,
  } = usePlayerStateSelector(
    (state) => ({
      isOpen: state.isOpen,
      currentItem: state.currentItem,
      showControls: state.showControls,
      markers: state.markers,
      isLoading: state.isLoading,
      error: state.error,
      isPlaying: state.isPlaying,
      canPlay: state.canPlay,
      currentTime: state.currentTime,
      duration: state.duration,
      streamOffset: state.streamOffset,
      streamSessionId: state.streamSessionId,
    }),
    shallow,
  );
  const volume = usePlayerPrefsStore((state) => state.volume);

  const closePlayer = playerCommands.closePlayer;
  const updatePlaybackState = playerCommands.updatePlaybackState;
  const { actions, videoRef } = useMediaPlayer();
  const seekFeedbackRef = useRef<MediaPlayerSeekFeedbackHandle>(null);
  const isMobile = useIsMobile();
  const sessionState = useSessionState();
  const playerItemServerId = currentItem?.serverId ?? null;
  const playerItemRatingKey = currentItem?.ratingKey ?? null;
  const streamServerUrl = currentItem?.serverUrl;
  const streamAuthToken = currentItem?.authToken;

  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

  const {
    onPlay,
    onPause,
    onTimeUpdate,
    onSeeked,
    onEnded,
    onStop,
    clearSession,
  } = useTimelineUpdates();

  // Register video-element actions into PlayerPort so the session service's
  // Syncplay controller can command play/pause/seek.
  useEffect(() => {
    if (
      !isOpen ||
      !playerItemServerId ||
      !playerItemRatingKey ||
      !streamSessionId ||
      !streamServerUrl ||
      !streamAuthToken
    ) {
      return;
    }

    const registeredPlayback = {
      serverId: playerItemServerId,
      ratingKey: playerItemRatingKey,
      streamSessionId,
    };
    return sessionCommands.registerPlayerActions({
      // Results flow through to the Syncplay controller: play() reports
      // whether playback actually started, seek() reports direct/reload/none
      // (it retries remote seeks that return "none").
      play: () =>
        isSessionControllingPlayback(registeredPlayback)
          ? actions.play()
          : false,
      pause: () => {
        if (isSessionControllingPlayback(registeredPlayback)) {
          actions.pause();
        }
      },
      seek: (seconds) =>
        isSessionControllingPlayback(registeredPlayback)
          ? actions.seek(seconds)
          : "none",
      prepareForReplacement: () =>
        stopPlaybackTranscodeSessions(
          streamServerUrl,
          streamAuthToken,
          streamSessionId,
        ),
    });
  }, [
    actions,
    isOpen,
    playerItemServerId,
    playerItemRatingKey,
    streamSessionId,
    streamServerUrl,
    streamAuthToken,
  ]);

  const isWatchTogetherSession =
    sessionState._tag === "Playing" || sessionState._tag === "Lobby";
  const isSessionPlaying = sessionState._tag === "Playing";
  const sessionItemServerId = isSessionPlaying
    ? sessionState.item.serverId
    : null;
  const sessionItemRatingKey = isSessionPlaying
    ? sessionState.item.ratingKey
    : null;
  const isSyncplayActiveForCurrentItem =
    isSessionPlaying &&
    sessionItemServerId === playerItemServerId &&
    sessionItemRatingKey === playerItemRatingKey;

  // A direct player replacement must not leave the previous room's controller
  // attached to unrelated media. Re-check after the current task so swapTo's
  // atomic SessionState + PlayerService item rotation can settle first.
  useEffect(() => {
    if (!isSessionPlaying || isSyncplayActiveForCurrentItem) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      const latestSession = sessionCommands.snapshot();
      const latestItem = playerCommands.snapshot().currentItem;
      if (
        latestSession._tag === "Playing" &&
        !itemsMatch(latestSession.item, latestItem)
      ) {
        void sessionCommands.leave({ suppressAutoStart: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    isSessionPlaying,
    sessionItemServerId,
    sessionItemRatingKey,
    playerItemServerId,
    playerItemRatingKey,
    isSyncplayActiveForCurrentItem,
  ]);

  const onSyncplayLocalPlaybackChange = useCallback((isPaused: boolean) => {
    const item = playerCommands.snapshot().currentItem;
    if (item && isSessionControllingItem(item)) {
      sessionCommands.handleLocalPlaybackChange(isPaused);
    }
  }, []);

  const onSyncplayLocalSeeked = useCallback((time: number) => {
    const item = playerCommands.snapshot().currentItem;
    if (item && isSessionControllingItem(item)) {
      sessionCommands.handleLocalSeeked(time);
    }
  }, []);

  const { autoPlayState, nextEpisode } = useAutoPlayNextEpisode({
    enabled: !isWatchTogetherSession,
  });
  // Watch Together sessions can't use solo autoplay (a lone client switching
  // items would desync the room), so they rotate the whole party into a new
  // room for the next episode instead — seamlessly, without leaving the modal.
  const watchTogetherAutoAdvance = useWatchTogetherRotation({
    enabled: isWatchTogetherSession,
    nextEpisode,
  });

  const handleVideoPlay = useCallback(() => {
    onPlay();
    onSyncplayLocalPlaybackChange(false);
  }, [onPlay, onSyncplayLocalPlaybackChange]);

  const handleVideoPause = useCallback(() => {
    onPause();
    onSyncplayLocalPlaybackChange(true);
  }, [onPause, onSyncplayLocalPlaybackChange]);

  const handleVideoSeeked = useCallback(
    (time: number) => {
      onSeeked(time);
    },
    [onSeeked],
  );

  // Plex's transcoded streams can't be seeked via `currentTime`; we reload the
  // stream at a new `streamOffset` instead, which never fires a `seeked` event.
  // Report those reload-seeks to Syncplay here so they propagate to the room.
  // (Remote-applied reload-seeks are filtered out by the session controller's
  // own suppression, so this doesn't echo them back.)
  // We seek a transcoded stream by reloading it at a new `streamOffset` (a new
  // transcode session). Report that seek to Syncplay so it propagates, and stop
  // the previous offset's transcode so seeking doesn't pile up sessions and hit
  // the server's transcode limit (HTTP 400 / "video source not supported").
  const previousStreamRef = useRef({
    sessionId: streamSessionId,
    offset: streamOffset,
  });
  useEffect(() => {
    const previousStream = previousStreamRef.current;
    if (streamSessionId !== previousStream.sessionId) {
      previousStreamRef.current = {
        sessionId: streamSessionId,
        offset: streamOffset,
      };
      return;
    }
    if (streamOffset === previousStream.offset) {
      return;
    }
    previousStreamRef.current = {
      sessionId: streamSessionId,
      offset: streamOffset,
    };
    onSyncplayLocalSeeked(streamOffset);
    if (streamSessionId && streamServerUrl && streamAuthToken) {
      void stopTranscodeSession(
        streamServerUrl,
        streamAuthToken,
        `${streamSessionId}-${Math.floor(previousStream.offset)}`,
      );
    }
  }, [
    streamOffset,
    onSyncplayLocalSeeked,
    streamSessionId,
    streamServerUrl,
    streamAuthToken,
  ]);

  // Stop this playback's transcode session(s) on the server when it ends (the
  // session id is cleared on close / changes on a new playback).
  useEffect(() => {
    if (!streamSessionId || !streamServerUrl || !streamAuthToken) {
      return;
    }
    return () => {
      void stopPlaybackTranscodeSessions(
        streamServerUrl,
        streamAuthToken,
        streamSessionId,
      );
    };
  }, [streamSessionId, streamServerUrl, streamAuthToken]);

  const handleClose = useCallback(() => {
    onStop();
    clearSession();
    // Deliberate leave — suppress auto-start for this room.
    void sessionCommands.leave({ suppressAutoStart: true });
    clearAllTimeouts();
    closePlayer();
  }, [onStop, clearSession, clearAllTimeouts, closePlayer]);

  const handleDragDismiss = useCallback(() => {
    const currentPlayback = playerCommands.playbackIdentity();
    if (
      currentPlayback?.serverId !== playerItemServerId ||
      currentPlayback?.ratingKey !== playerItemRatingKey ||
      currentPlayback?.streamSessionId !== streamSessionId
    ) {
      return;
    }

    handleClose();
  }, [handleClose, playerItemServerId, playerItemRatingKey, streamSessionId]);

  const {
    ref: dragRef,
    handlers: dragHandlers,
    isDragging,
  } = useDragToDismiss({
    enabled: isOpen && isMobile,
    onDismiss: handleDragDismiss,
    // Mobile mode CSS-rotates the player content 90° CW so a portrait phone
    // shows landscape video. Visual-down therefore lives on the physical
    // -X axis, and the player must slide off to physical left to dismiss.
    rotation: isMobile ? 90 : 0,
  });

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
    if (isSettingsOpen) return;
    hideControlsDelayed(1000);
  }, [hideControlsDelayed, isSettingsOpen]);

  const handleMouseMove = useCallback(() => {
    showControlsImmediate();
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
    }
    if (isSettingsOpen) return;
    mouseMoveTimeoutRef.current = setTimeout(() => {
      hideControlsDelayed(0);
    }, 3000);
  }, [showControlsImmediate, hideControlsDelayed, isSettingsOpen]);

  // Keep the controls pinned while the settings popover is open and
  // restart the auto-hide cycle once it closes.
  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        showControlsImmediate();
      } else if (!isMobile) {
        handleMouseMove();
      } else {
        hideControlsDelayed(MOBILE_CONTROLS_HIDE_DELAY_MS);
      }
    },
    [showControlsImmediate, handleMouseMove, hideControlsDelayed, isMobile],
  );

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    hideControlsDelayed(MOBILE_CONTROLS_HIDE_DELAY_MS);
    return clearAllTimeouts;
  }, [isOpen, isMobile, hideControlsDelayed, clearAllTimeouts]);

  // Escape must run the same full close path as the X button (stop timeline,
  // pause the Watch Together room, clear the session), not just close the
  // modal.
  const keyboardActions = useMemo(
    () => ({ ...actionsWithSeekFeedback, closePlayer: handleClose }),
    [actionsWithSeekFeedback, handleClose],
  );

  useKeyboardShortcuts({
    isOpen,
    actions: keyboardActions,
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

  const mobileChromeVisible = isMobile && showControls && !isDragging;

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
          ref={isMobile ? dragRef : undefined}
          className={`group cursor-none overflow-visible hover:cursor-default ${
            isMobile
              ? "fixed inset-0 flex touch-none items-center justify-center"
              : "relative h-full w-full overflow-hidden"
          }`}
          style={isMobile ? { willChange: "transform, opacity" } : undefined}
          onMouseEnter={isMobile ? undefined : handleMouseEnter}
          onMouseLeave={isMobile ? undefined : handleMouseLeave}
          onMouseMove={isMobile ? undefined : handleMouseMove}
          onPointerDown={isMobile ? dragHandlers.onPointerDown : undefined}
          onPointerMove={isMobile ? dragHandlers.onPointerMove : undefined}
          onPointerUp={isMobile ? dragHandlers.onPointerUp : undefined}
          onPointerCancel={isMobile ? dragHandlers.onPointerCancel : undefined}
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
                isWatchTogetherActive={isSyncplayActiveForCurrentItem}
                onMobileSurfaceTap={isMobile ? handleSurfaceTap : undefined}
                onVideoClick={isMobile ? undefined : handleVideoClick}
                onVideoDoubleClick={handleVideoDoubleClick}
                onVolumeScroll={handleVolumeScroll}
                onVideoEnded={onEnded}
                onVideoPlay={handleVideoPlay}
                onVideoPause={handleVideoPause}
                onVideoTimeUpdate={onTimeUpdate}
                onVideoSeeking={onSyncplayLocalSeeked}
                onVideoSeeked={handleVideoSeeked}
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
                isCountingDown={
                  isWatchTogetherSession
                    ? watchTogetherAutoAdvance.isCountingDown
                    : autoPlayState.isCountingDown
                }
                countdownSeconds={
                  isWatchTogetherSession
                    ? watchTogetherAutoAdvance.countdownSeconds
                    : autoPlayState.countdownSeconds
                }
                nextEpisode={
                  isWatchTogetherSession
                    ? watchTogetherAutoAdvance.nextEpisode
                    : autoPlayState.nextEpisode
                }
                showActions={!isWatchTogetherSession}
              />

              {isMobile ? (
                <MediaPlayerChromeFade
                  visible={mobileChromeVisible}
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
                      onSettingsOpenChange={handleSettingsOpenChange}
                      isWatchTogetherActive={isSyncplayActiveForCurrentItem}
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
                    onSettingsOpenChange={handleSettingsOpenChange}
                    isWatchTogetherActive={isSyncplayActiveForCurrentItem}
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

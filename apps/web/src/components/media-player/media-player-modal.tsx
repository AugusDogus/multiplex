"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type ComponentPropsWithRef,
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
} from "./media-player-overlay";
import { MediaPlayerSkipOverlay } from "./media-player-skip-overlay";
import { MediaPlayerAutoPlayOverlay } from "./media-player-autoplay-overlay";
import { MediaPlayerVideo } from "./media-player-video";
import type { MediaPlayerSeekFeedbackHandle } from "./media-player-video";
import {
  stopPlaybackTranscodeSessions,
  stopTranscodeSession,
} from "./utils/plex-stream-urls";
import { mediaPlayerControlsTransition } from "./utils/media-player-controls-transition";
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

function onSyncplayLocalPlaybackChange(isPaused: boolean) {
  const item = playerCommands.snapshot().currentItem;
  if (item && isSessionControllingItem(item)) {
    sessionCommands.handleLocalPlaybackChange(isPaused);
  }
}

function onSyncplayLocalSeeked(time: number) {
  const item = playerCommands.snapshot().currentItem;
  if (item && isSessionControllingItem(item)) {
    sessionCommands.handleLocalSeeked(time);
  }
}

function stopOverlayPointer(event: PointerEvent) {
  event.stopPropagation();
}

interface PlayerChromeControllerOptions {
  actions: ReturnType<typeof useMediaPlayer>["actions"];
  currentTime: number;
  duration: number;
  isMobile: boolean;
  isOpen: boolean;
  showControls: boolean;
}

function usePlayerChromeController({
  actions,
  currentTime,
  duration,
  isMobile,
  isOpen,
  showControls,
}: PlayerChromeControllerOptions) {
  const seekFeedbackRef = useRef<MediaPlayerSeekFeedbackHandle>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseMoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isSettingsOpenRef = useRef(false);

  const clearAllTimeouts = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
      mouseMoveTimeoutRef.current = null;
    }
  };

  const showControlsImmediate = () => {
    clearAllTimeouts();
    playerCommands.updatePlaybackState({ showControls: true });
  };

  const hideControlsDelayed = (delay = MOBILE_CONTROLS_HIDE_DELAY_MS) => {
    clearAllTimeouts();
    hideTimeoutRef.current = setTimeout(() => {
      playerCommands.updatePlaybackState({ showControls: false });
    }, delay);
  };

  const hideControlsImmediate = () => {
    clearAllTimeouts();
    playerCommands.updatePlaybackState({ showControls: false });
  };

  const handleMobileDoubleTapSeek = (zone: MobileSeekZone) => {
    if (zone === "forward") {
      actions.skipForward(SEEK_SECONDS);
      seekFeedbackRef.current?.presentSeek("forward");
    } else {
      actions.skipBackward(SEEK_SECONDS);
      seekFeedbackRef.current?.presentSeek("backward");
    }
  };

  const { handleSurfaceTap, resetAutoHide: resetMobileControlsTimer } =
    useMobileVideoChrome({
      showControls,
      showControlsImmediate,
      hideControlsImmediate,
      hideControlsDelayed,
      onDoubleTapSeek: handleMobileDoubleTapSeek,
    });

  const showSeekFeedback = (
    direction: "backward" | "forward",
    seconds: number,
    accumulate = true,
  ) => {
    if (!isMobile) {
      seekFeedbackRef.current?.show(direction, seconds, accumulate);
    }
  };

  const actionsWithSeekFeedback = {
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

  const handleCenterTogglePlay = () => {
    actions.togglePlay();
    resetMobileControlsTimer();
  };

  const handleMobileSkipBackward = () => {
    actions.skipBackward(SEEK_SECONDS);
    seekFeedbackRef.current?.presentSeek("backward");
    resetMobileControlsTimer();
  };

  const handleMobileSkipForward = () => {
    actions.skipForward(SEEK_SECONDS);
    seekFeedbackRef.current?.presentSeek("forward");
    resetMobileControlsTimer();
  };

  const handleMouseEnter = () => {
    showControlsImmediate();
  };

  const handleMouseLeave = () => {
    if (isSettingsOpenRef.current) return;
    hideControlsDelayed(1000);
  };

  const handleMouseMove = () => {
    showControlsImmediate();
    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current);
    }
    if (isSettingsOpenRef.current) return;
    mouseMoveTimeoutRef.current = setTimeout(() => {
      hideControlsDelayed(0);
    }, 3000);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    isSettingsOpenRef.current = open;
    if (open) {
      showControlsImmediate();
    } else if (!isMobile) {
      handleMouseMove();
    } else {
      hideControlsDelayed(MOBILE_CONTROLS_HIDE_DELAY_MS);
    }
  };

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    clearAllTimeouts();
    hideTimeoutRef.current = setTimeout(() => {
      playerCommands.updatePlaybackState({ showControls: false });
    }, MOBILE_CONTROLS_HIDE_DELAY_MS);
    return clearAllTimeouts;
  }, [isOpen, isMobile]);

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

  return {
    actionsWithSeekFeedback,
    chromeClassName,
    clearAllTimeouts,
    handleCenterTogglePlay,
    handleMobileSkipBackward,
    handleMobileSkipForward,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    handleSettingsOpenChange,
    handleSurfaceTap,
    resetMobileControlsTimer,
    seekFeedbackRef,
  };
}

interface PlaybackSessionControllerOptions {
  actions: ReturnType<typeof useMediaPlayer>["actions"];
  currentItem: ComponentProps<typeof MediaPlayerOverlay>["item"] | null;
  isOpen: boolean;
  streamOffset: number;
  streamSessionId: string;
}

function usePlaybackSessionController({
  actions,
  currentItem,
  isOpen,
  streamOffset,
  streamSessionId,
}: PlaybackSessionControllerOptions) {
  const sessionState = useSessionState();
  const playerItemServerId = currentItem?.serverId ?? null;
  const playerItemRatingKey = currentItem?.ratingKey ?? null;
  const streamServerUrl = currentItem?.serverUrl;
  const streamAuthToken = currentItem?.authToken;
  const timeline = useTimelineUpdates();

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
    currentItem,
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

  // Intentionally no clear-on-mismatch leave: WatchTogetherSession owns the
  // Playing room+item pair (swapPlayingRoom is atomic). Inferring "leave" from
  // a transient React gap between session.item and player.currentItem during
  // episode rotation tears down Syncplay and breaks pause sync.

  const { autoPlayState, nextEpisode } = useAutoPlayNextEpisode({
    enabled: !isWatchTogetherSession,
  });
  const watchTogetherAutoAdvance = useWatchTogetherRotation({
    enabled: isWatchTogetherSession,
    nextEpisode,
  });

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
    streamSessionId,
    streamServerUrl,
    streamAuthToken,
    currentItem,
  ]);

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
  }, [streamSessionId, streamServerUrl, streamAuthToken, currentItem]);

  return {
    autoPlayProps: {
      isCountingDown: isWatchTogetherSession
        ? watchTogetherAutoAdvance.isCountingDown
        : autoPlayState.isCountingDown,
      countdownSeconds: isWatchTogetherSession
        ? watchTogetherAutoAdvance.countdownSeconds
        : autoPlayState.countdownSeconds,
      nextEpisode: isWatchTogetherSession
        ? watchTogetherAutoAdvance.nextEpisode
        : autoPlayState.nextEpisode,
      showActions: !isWatchTogetherSession,
    } satisfies ComponentProps<typeof MediaPlayerAutoPlayOverlay>,
    clearTimelineSession: timeline.clearSession,
    handleVideoPause: () => {
      timeline.onPause();
      onSyncplayLocalPlaybackChange(true);
    },
    handleVideoPlay: () => {
      timeline.onPlay();
      onSyncplayLocalPlaybackChange(false);
    },
    isSyncplayActiveForCurrentItem,
    onEnded: timeline.onEnded,
    onStop: timeline.onStop,
    onTimeUpdate: timeline.onTimeUpdate,
    onVideoSeeked: timeline.onSeeked,
    playerItemRatingKey,
    playerItemServerId,
  };
}

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
  const { actions, videoRef } = useMediaPlayer();
  const isMobile = useIsMobile();
  const {
    actionsWithSeekFeedback,
    chromeClassName,
    clearAllTimeouts,
    handleCenterTogglePlay,
    handleMobileSkipBackward,
    handleMobileSkipForward,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    handleSettingsOpenChange,
    handleSurfaceTap,
    resetMobileControlsTimer,
    seekFeedbackRef,
  } = usePlayerChromeController({
    actions,
    currentTime,
    duration,
    isMobile,
    isOpen,
    showControls,
  });
  usePlayQueue(currentItem);

  const {
    autoPlayProps,
    clearTimelineSession,
    handleVideoPause,
    handleVideoPlay,
    isSyncplayActiveForCurrentItem,
    onEnded,
    onStop,
    onTimeUpdate,
    onVideoSeeked,
    playerItemRatingKey,
    playerItemServerId,
  } = usePlaybackSessionController({
    actions,
    currentItem,
    isOpen,
    streamOffset,
    streamSessionId,
  });

  const handleClose = () => {
    onStop();
    clearTimelineSession();
    // Deliberate leave — suppress auto-start for this room.
    void sessionCommands.leave({ suppressAutoStart: true });
    clearAllTimeouts();
    closePlayer();
  };

  const handleDragDismiss = () => {
    const currentPlayback = playerCommands.playbackIdentity();
    if (
      currentPlayback?.serverId !== playerItemServerId ||
      currentPlayback?.ratingKey !== playerItemRatingKey ||
      currentPlayback?.streamSessionId !== streamSessionId
    ) {
      return;
    }

    handleClose();
  };

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

  const handleVideoClick = () => {
    actions.togglePlay();
  };

  const handleVideoDoubleClick = () => {
    actions.toggleFullscreen();
  };

  const handleVolumeScroll = (delta: number) => {
    const volumeStep = 0.1;
    const newVolume = Math.max(
      0,
      Math.min(1, volume + (delta > 0 ? volumeStep : -volumeStep)),
    );
    actions.setVolume(newVolume);
  };

  // Escape must run the same full close path as the X button (stop timeline,
  // pause the Watch Together room, clear the session), not just close the
  // modal.
  const keyboardActions = {
    ...actionsWithSeekFeedback,
    closePlayer: handleClose,
  };

  useKeyboardShortcuts({
    isOpen,
    actions: keyboardActions,
    currentTime,
    duration,
    volume,
  });

  const mobileChromeVisible = isMobile && showControls && !isDragging;

  if (!currentItem) return null;

  return (
    <MediaPlayerModalView
      onClose={handleClose}
      dragRef={dragRef}
      dragHandlers={dragHandlers}
      chromeClassName={chromeClassName}
      mobileChromeVisible={mobileChromeVisible}
      currentItem={currentItem}
      playbackState={{
        isOpen,
        isMobile,
        showControls,
        isLoading,
        error,
        isPlaying,
        canPlay,
        isWatchTogetherActive: isSyncplayActiveForCurrentItem,
      }}
      markers={markers}
      currentTime={currentTime}
      actions={actions}
      autoPlayProps={autoPlayProps}
      videoProps={{
        ref: videoRef,
        seekFeedbackRef,
        item: currentItem,
        className: "h-full w-full",
        useMobileSurfaceGestures: isMobile,
        isWatchTogetherActive: isSyncplayActiveForCurrentItem,
        onMobileSurfaceTap: isMobile ? handleSurfaceTap : undefined,
        onVideoClick: isMobile ? undefined : handleVideoClick,
        onVideoDoubleClick: handleVideoDoubleClick,
        onVolumeScroll: handleVolumeScroll,
        onVideoEnded: onEnded,
        onVideoPlay: handleVideoPlay,
        onVideoPause: handleVideoPause,
        onVideoTimeUpdate: onTimeUpdate,
        onVideoSeeking: onSyncplayLocalSeeked,
        onVideoSeeked,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onCenterTogglePlay={handleCenterTogglePlay}
      onMobileSkipBackward={handleMobileSkipBackward}
      onMobileSkipForward={handleMobileSkipForward}
      onSettingsOpenChange={handleSettingsOpenChange}
      onResetMobileControlsTimer={resetMobileControlsTimer}
    />
  );
}

interface MediaPlayerModalViewProps {
  onClose: () => void;
  dragRef: ReturnType<typeof useDragToDismiss>["ref"];
  dragHandlers: ReturnType<typeof useDragToDismiss>["handlers"];
  chromeClassName: string | undefined;
  mobileChromeVisible: boolean;
  currentItem: ComponentProps<typeof MediaPlayerOverlay>["item"];
  playbackState: {
    isOpen: boolean;
    isMobile: boolean;
    showControls: boolean;
    isLoading: boolean;
    error: string | null;
    isPlaying: boolean;
    canPlay: boolean;
    isWatchTogetherActive: boolean;
  };
  markers: ComponentProps<typeof MediaPlayerSkipOverlay>["markers"];
  currentTime: number;
  actions: ReturnType<typeof useMediaPlayer>["actions"];
  autoPlayProps: ComponentProps<typeof MediaPlayerAutoPlayOverlay>;
  videoProps: ComponentPropsWithRef<typeof MediaPlayerVideo>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseMove: () => void;
  onCenterTogglePlay: () => void;
  onMobileSkipBackward: () => void;
  onMobileSkipForward: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  onResetMobileControlsTimer: () => void;
}

function MediaPlayerModalView({
  onClose,
  dragRef,
  dragHandlers,
  chromeClassName,
  mobileChromeVisible,
  currentItem,
  playbackState,
  markers,
  currentTime,
  actions,
  autoPlayProps,
  videoProps,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onCenterTogglePlay,
  onMobileSkipBackward,
  onMobileSkipForward,
  onSettingsOpenChange,
  onResetMobileControlsTimer,
}: MediaPlayerModalViewProps) {
  const {
    isOpen,
    isMobile,
    showControls,
    isLoading,
    error,
    isPlaying,
    canPlay,
    isWatchTogetherActive,
  } = playbackState;

  return (
    <Dialog modal={false} open={isOpen} onOpenChange={onClose}>
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
          onMouseEnter={isMobile ? undefined : onMouseEnter}
          onMouseLeave={isMobile ? undefined : onMouseLeave}
          onMouseMove={isMobile ? undefined : onMouseMove}
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
              <PlayerCloseButton
                className={chromeClassName}
                onClose={onClose}
              />
            )}

            <div className="relative h-full w-full">
              <MediaPlayerVideo {...videoProps} />
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
              <MediaPlayerAutoPlayOverlay {...autoPlayProps} />

              {isMobile ? (
                <MediaPlayerChromeFade
                  visible={mobileChromeVisible}
                  className="absolute inset-0 z-30"
                >
                  <MediaPlayerTitleChrome item={currentItem} />
                  <PlayerCloseButton mobile onClose={onClose} />
                  <MediaPlayerCenterControls
                    isVisible
                    isPlaying={isPlaying}
                    disabled={!canPlay}
                    onTogglePlay={onCenterTogglePlay}
                    onSkipBackward={onMobileSkipBackward}
                    onSkipForward={onMobileSkipForward}
                  />
                  <div
                    className="pointer-events-auto absolute right-0 bottom-0 left-0 z-30"
                    onPointerDown={(event) => {
                      stopOverlayPointer(event);
                      onResetMobileControlsTimer();
                    }}
                  >
                    <MediaPlayerControls
                      isVisible
                      actions={actions}
                      progressOnly
                      className="px-4 py-2"
                      onSettingsOpenChange={onSettingsOpenChange}
                      isWatchTogetherActive={isWatchTogetherActive}
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
                    onSettingsOpenChange={onSettingsOpenChange}
                    isWatchTogetherActive={isWatchTogetherActive}
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

function PlayerCloseButton({
  mobile = false,
  className,
  onClose,
}: {
  mobile?: boolean;
  className?: string;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        mobile
          ? "pointer-events-auto absolute top-4 right-4 z-50"
          : "absolute top-4 right-4 z-50",
        className,
      )}
      onPointerDown={stopOverlayPointer}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
        className="text-white hover:bg-white/20"
      >
        <X className="h-6 w-6" />
      </Button>
    </div>
  );
}

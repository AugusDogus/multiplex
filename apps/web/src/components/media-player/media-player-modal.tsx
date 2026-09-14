"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { getMediaToggleAction, useMediaPlayer } from "./hooks/use-media-player";
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
  buildPlexTranscodeSessionKey,
  consumeStoppedTranscodeSession,
  stopPlaybackTranscodeSessions,
  stopTranscodeSession,
} from "./utils/plex-stream-urls";
import { buildPlexPlaybackPlan } from "./utils/plex-playback-plan";
import {
  browserReloadStorage,
  storeReloadPlaybackSession,
} from "./utils/reload-playback-session";
import { mediaPlayerControlsTransition } from "./utils/media-player-controls-transition";
import { useIsMobile } from "~/hooks/use-mobile";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { cn } from "~/lib/utils";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { shallow } from "zustand/shallow";

/* ────────────────────────────────────────────────────────────
   Media Player Modal
   Main modal container using the Coss Dialog primitives
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
  transcodeSessionId: string;
  transcodeSessionKey: string | null;
  preparePlayerForReplacement: () => void;
}

function usePlaybackSessionController({
  actions,
  currentItem,
  isOpen,
  streamOffset,
  streamSessionId,
  transcodeSessionId,
  transcodeSessionKey,
  preparePlayerForReplacement,
}: PlaybackSessionControllerOptions) {
  const sessionState = useSessionState();
  const playerItemServerId = currentItem?.serverId ?? null;
  const playerItemRatingKey = currentItem?.ratingKey ?? null;
  const streamServerUrl = currentItem?.serverUrl;
  const streamAuthToken = currentItem?.authToken;
  const isGuestTransient = currentItem?.access === "guest-transient";
  const timeline = useTimelineUpdates({ enabled: !isGuestTransient });
  const actionsRef = useRef(actions);
  const preparePlayerForReplacementRef = useRef(preparePlayerForReplacement);

  useEffect(() => {
    actionsRef.current = actions;
    preparePlayerForReplacementRef.current = preparePlayerForReplacement;
  }, [actions, preparePlayerForReplacement]);

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
          ? actionsRef.current.play()
          : false,
      pause: () => {
        if (isSessionControllingPlayback(registeredPlayback)) {
          actionsRef.current.pause();
        }
      },
      seek: (seconds) =>
        isSessionControllingPlayback(registeredPlayback)
          ? actionsRef.current.seek(seconds)
          : "none",
      setPlaybackRate: (rate) => {
        if (isSessionControllingPlayback(registeredPlayback)) {
          actionsRef.current.setPlaybackRate(rate);
        }
      },
      prepareForReplacement: async () => {
        preparePlayerForReplacementRef.current();
        await stopPlaybackTranscodeSessions(
          streamServerUrl,
          streamAuthToken,
          transcodeSessionId,
        );
      },
    });
  }, [
    isOpen,
    playerItemServerId,
    playerItemRatingKey,
    streamSessionId,
    transcodeSessionId,
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

  // Intentionally no clear-on-mismatch leave: WatchTogetherSession owns the
  // Playing room+item pair (swapPlayingRoom is atomic). Inferring "leave" from
  // a transient React gap between session.item and player.currentItem during
  // episode rotation tears down Syncplay and breaks pause sync.

  const { autoPlayState, nextEpisode } = useAutoPlayNextEpisode({
    enabled: !isWatchTogetherSession,
  });
  const watchTogetherAutoAdvance = useWatchTogetherRotation({
    enabled: isWatchTogetherSession && !isGuestTransient,
    nextEpisode,
  });

  const previousStreamRef = useRef({
    sessionId: transcodeSessionId,
    offset: streamOffset,
    transcodeSessionKey,
  });
  useEffect(() => {
    const previousStream = previousStreamRef.current;
    if (transcodeSessionId !== previousStream.sessionId) {
      previousStreamRef.current = {
        sessionId: transcodeSessionId,
        offset: streamOffset,
        transcodeSessionKey,
      };
      return;
    }

    previousStreamRef.current = {
      sessionId: transcodeSessionId,
      offset: streamOffset,
      transcodeSessionKey,
    };

    if (
      previousStream.transcodeSessionKey &&
      previousStream.transcodeSessionKey !== transcodeSessionKey &&
      streamServerUrl &&
      streamAuthToken
    ) {
      if (!consumeStoppedTranscodeSession(previousStream.transcodeSessionKey)) {
        void stopTranscodeSession(
          streamServerUrl,
          streamAuthToken,
          previousStream.transcodeSessionKey,
        );
      }
      void stopPlaybackTranscodeSessions(
        streamServerUrl,
        streamAuthToken,
        transcodeSessionId,
        {
          keepSessionKey: () =>
            previousStreamRef.current.transcodeSessionKey ?? null,
        },
      );
    }
  }, [
    streamOffset,
    streamSessionId,
    transcodeSessionId,
    transcodeSessionKey,
    streamServerUrl,
    streamAuthToken,
  ]);

  useEffect(() => {
    if (!transcodeSessionId || !streamServerUrl || !streamAuthToken) {
      return;
    }
    return () => {
      // Stop the one stream we know is active without first listing sessions.
      // This keepalive request can survive an abrupt tab/browser close; the
      // broader prefix cleanup below remains useful for any older seek stream.
      if (previousStreamRef.current.transcodeSessionKey) {
        void stopTranscodeSession(
          streamServerUrl,
          streamAuthToken,
          previousStreamRef.current.transcodeSessionKey,
        );
      }
      void stopPlaybackTranscodeSessions(
        streamServerUrl,
        streamAuthToken,
        transcodeSessionId,
      );
    };
  }, [transcodeSessionId, streamServerUrl, streamAuthToken]);

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
    },
    handleVideoPlay: () => {
      timeline.onPlay();
    },
    isSyncplayActiveForCurrentItem,
    onEnded: () => {
      timeline.onEnded();
      // A playing Syncplay heartbeat can otherwise restart an ended media
      // element at zero before the room-rotation loop creates its successor.
      // Treat EOF as explicit local intent so the party remains at the end
      // while rotation finishes gathering the next room.
      onSyncplayLocalPlaybackChange(true);
    },
    onStop: timeline.onStop,
    onTimeUpdate: timeline.onTimeUpdate,
    onVideoSeeked: timeline.onSeeked,
    playerItemRatingKey,
    playerItemServerId,
  };
}

function useMediaPlayerModalController(): MediaPlayerModalViewProps | null {
  const router = useRouter();
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
    transcodeSessionId,
    transcodeAttempt,
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
      transcodeSessionId: state.transcodeSessionId,
      transcodeAttempt: state.transcodeAttempt,
    }),
    shallow,
  );
  const volume = usePlayerPrefsStore((state) => state.volume);

  const closePlayer = playerCommands.closePlayer;
  const {
    actions,
    videoRef,
    consumePauseRequest,
    prepareForReplacement: preparePlayerForReplacement,
  } = useMediaPlayer();
  const isMobile = useIsMobile();
  usePlayQueue(currentItem, {
    enabled: currentItem?.access !== "guest-transient",
  });
  const playbackPlan = currentItem ? buildPlexPlaybackPlan(currentItem) : null;
  const transcodeSessionKey =
    playbackPlan?.videoUsesTranscode && transcodeSessionId
      ? buildPlexTranscodeSessionKey(
          transcodeSessionId,
          streamOffset,
          playbackPlan,
          transcodeAttempt,
        )
      : null;

  useEffect(() => {
    if (
      !isOpen ||
      !playbackPlan?.videoUsesTranscode ||
      !currentItem ||
      !streamSessionId
    ) {
      return;
    }

    const persistForReload = () => {
      const storage = browserReloadStorage();
      if (!storage) return;
      storeReloadPlaybackSession(storage, {
        serverId: currentItem.serverId,
        ratingKey: currentItem.ratingKey,
        streamSessionId,
        transcodeSessionId,
        streamOffset,
        transcodeAttempt,
        savedAt: Date.now(),
      });
    };

    window.addEventListener("beforeunload", persistForReload);
    window.addEventListener("pagehide", persistForReload);
    return () => {
      window.removeEventListener("beforeunload", persistForReload);
      window.removeEventListener("pagehide", persistForReload);
    };
  }, [
    currentItem,
    isOpen,
    playbackPlan?.videoUsesTranscode,
    streamOffset,
    streamSessionId,
    transcodeSessionId,
    transcodeAttempt,
  ]);

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
    transcodeSessionId,
    transcodeSessionKey,
    preparePlayerForReplacement,
  });

  const claimReloadSeek = (result: ReturnType<typeof actions.seek>) => {
    if (result === "reload" && isSyncplayActiveForCurrentItem) {
      onSyncplayLocalSeeked(playerCommands.snapshot().currentTime);
    }
    return result;
  };
  // Claim UI-originated transcode seeks before their coalesced source
  // replacement runs. PlayerPort keeps the raw actions so applying a remote
  // seek never claims that seek back as a local command.
  const localActions = {
    ...actions,
    play: () => {
      onSyncplayLocalPlaybackChange(false);
      return actions.play();
    },
    pause: () => {
      onSyncplayLocalPlaybackChange(true);
      actions.pause();
    },
    togglePlay: () => {
      const toggleAction = getMediaToggleAction(
        videoRef.current,
        playerCommands.snapshot().isPlaying,
      );
      onSyncplayLocalPlaybackChange(toggleAction === "pause");
      actions.togglePlay();
    },
    seek: (seconds: number) => claimReloadSeek(actions.seek(seconds)),
    skipForward: (seconds?: number) =>
      claimReloadSeek(actions.skipForward(seconds)),
    skipBackward: (seconds?: number) =>
      claimReloadSeek(actions.skipBackward(seconds)),
    jumpToStart: () => claimReloadSeek(actions.jumpToStart()),
    jumpToEnd: () => claimReloadSeek(actions.jumpToEnd()),
    seekToMarkerEnd: (marker: Parameters<typeof actions.seekToMarkerEnd>[0]) =>
      claimReloadSeek(actions.seekToMarkerEnd(marker)),
  };
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
    actions: localActions,
    currentTime,
    duration,
    isMobile,
    isOpen,
    showControls,
  });

  const handleClose = () => {
    // Commit the live room before leave → Idle. WatchTogetherSessionShell
    // soft-navs during Playing; this covers close if the segment still lags.
    const session = sessionCommands.snapshot();
    if (
      currentItem?.access !== "guest-transient" &&
      (session._tag === "Playing" || session._tag === "Lobby")
    ) {
      const href = getWatchTogetherRoomHref(session.room.id);
      if (window.location.pathname !== href) {
        router.replace(href);
      }
    }
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
    localActions.togglePlay();
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
    duration,
    volume,
  });

  const mobileChromeVisible = isMobile && showControls && !isDragging;

  if (!currentItem) return null;

  return {
    onClose: handleClose,
    dragRef,
    dragHandlers,
    chromeClassName,
    mobileChromeVisible,
    currentItem,
    playbackState: {
      isOpen,
      isMobile,
      showControls,
      isLoading,
      error,
      isPlaying,
      canPlay,
      isWatchTogetherActive: isSyncplayActiveForCurrentItem,
    },
    markers,
    currentTime,
    actions: localActions,
    autoPlayProps,
    videoProps: {
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
      consumePauseRequest,
      onVideoTimeUpdate: onTimeUpdate,
      onVideoSeeking: onSyncplayLocalSeeked,
      onVideoSeeked,
    },
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onMouseMove: handleMouseMove,
    onCenterTogglePlay: handleCenterTogglePlay,
    onMobileSkipBackward: handleMobileSkipBackward,
    onMobileSkipForward: handleMobileSkipForward,
    onSettingsOpenChange: handleSettingsOpenChange,
    onResetMobileControlsTimer: resetMobileControlsTimer,
  };
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

export function MediaPlayerModal() {
  const viewProps = useMediaPlayerModalController();
  return viewProps ? <MediaPlayerModalView {...viewProps} /> : null;
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
  const playToggleRef = useRef<HTMLButtonElement>(null);
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
      <MediaPlayerDialogContent initialFocus={playToggleRef}>
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
                    playToggleRef={playToggleRef}
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
                    playToggleRef={playToggleRef}
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

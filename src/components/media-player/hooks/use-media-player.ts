"use client";

import { useAtom } from "jotai";
import { useCallback, useRef } from "react";
import {
  closeMediaPlayerAtom,
  mediaPlayerStateAtom,
  updatePlaybackStateAtom,
} from "~/atoms/media-player";
import type { MediaPlayerActions } from "~/types/media-player";
import { clamp, supportsFullscreen } from "../utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Main Media Player Hook
   Primary hook for media player state and actions
   ──────────────────────────────────────────────────────────── */

export function useMediaPlayer(): {
  state: ReturnType<typeof useAtom<typeof mediaPlayerStateAtom>>[0];
  actions: MediaPlayerActions & {
    skipForward: (seconds?: number) => void;
    skipBackward: (seconds?: number) => void;
    jumpToStart: () => void;
    jumpToEnd: () => void;
  };
  videoRef: React.RefObject<HTMLVideoElement | null>;
} {
  const [state] = useAtom(mediaPlayerStateAtom);
  const [, updateState] = useAtom(updatePlaybackStateAtom);
  const [, closePlayer] = useAtom(closeMediaPlayerAtom);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Start video playback
   */
  const play = useCallback(async () => {
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        updateState({ isPlaying: true });
      } catch (error) {
        console.error("Failed to play video:", error);
        updateState({
          error: "Failed to start video playback",
          isPlaying: false,
        });
      }
    }
  }, [updateState]);

  /**
   * Pause video playback
   */
  const pause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      updateState({ isPlaying: false });
    }
  }, [updateState]);

  /**
   * Toggle play/pause state
   */
  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [state.isPlaying, play, pause]);

  /**
   * Seek to a specific time in the video
   * @param time - Time to seek to in seconds
   */
  const seek = useCallback(
    (time: number) => {
      if (videoRef.current) {
        const clampedTime = clamp(time, 0, state.duration);
        videoRef.current.currentTime = clampedTime;
        updateState({ currentTime: clampedTime });
      }
    },
    [state.duration, updateState],
  );

  /**
   * Set the volume level
   * @param volume - Volume level (0-1)
   */
  const setVolume = useCallback(
    (volume: number) => {
      if (videoRef.current) {
        const clampedVolume = clamp(volume, 0, 1);
        videoRef.current.volume = clampedVolume;
        updateState({ volume: clampedVolume });
      }
    },
    [updateState],
  );

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const newMuted = !state.isMuted;
      videoRef.current.muted = newMuted;
      updateState({ isMuted: newMuted });
    }
  }, [state.isMuted, updateState]);

  /**
   * Toggle fullscreen mode
   */
  const toggleFullscreen = useCallback(() => {
    if (!supportsFullscreen()) {
      console.warn("Fullscreen not supported");
      return;
    }

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(
        () => updateState({ isFullscreen: true }),
        (error) => console.error("Fullscreen request failed:", error),
      );
    } else {
      document.exitFullscreen().then(
        () => updateState({ isFullscreen: false }),
        (error) => console.error("Exit fullscreen failed:", error),
      );
    }
  }, [updateState]);

  /**
   * Show controls temporarily and set timeout to hide them
   */
  const showControlsTemporarily = useCallback(() => {
    updateState({ showControls: true });

    // Clear existing timeout
    if (state.controlsTimeout) {
      clearTimeout(state.controlsTimeout);
    }

    // Set new timeout to hide controls
    const timeout = setTimeout(() => {
      updateState({ showControls: false, controlsTimeout: null });
    }, 3000);

    updateState({ controlsTimeout: timeout });
  }, [state.controlsTimeout, updateState]);

  /**
   * Skip forward by a specified number of seconds
   * @param seconds - Number of seconds to skip forward (default: 10)
   */
  const skipForward = useCallback(
    (seconds = 10) => {
      const newTime = Math.min(state.currentTime + seconds, state.duration);
      seek(newTime);
    },
    [state.currentTime, state.duration, seek],
  );

  /**
   * Skip backward by a specified number of seconds
   * @param seconds - Number of seconds to skip backward (default: 10)
   */
  const skipBackward = useCallback(
    (seconds = 10) => {
      const newTime = Math.max(state.currentTime - seconds, 0);
      seek(newTime);
    },
    [state.currentTime, seek],
  );

  /**
   * Jump to the beginning of the video
   */
  const jumpToStart = useCallback(() => {
    seek(0);
  }, [seek]);

  /**
   * Jump to the end of the video
   */
  const jumpToEnd = useCallback(() => {
    seek(state.duration);
  }, [state.duration, seek]);

  // Placeholder for openPlayer - this is handled by the atom directly
  const openPlayer = useCallback(() => {
    console.warn("openPlayer should be called via openMediaPlayerAtom");
  }, []);

  const actions: MediaPlayerActions = {
    play: () => {
      void play();
    },
    pause,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
    showControlsTemporarily,
    openPlayer,
    closePlayer,
  };

  // Extended actions for internal use
  const extendedActions = {
    ...actions,
    skipForward,
    skipBackward,
    jumpToStart,
    jumpToEnd,
  };

  return {
    state,
    actions: extendedActions,
    videoRef,
  };
}

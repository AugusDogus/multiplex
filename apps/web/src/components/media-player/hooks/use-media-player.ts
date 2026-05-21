"use client";

import { useCallback, useRef } from "react";
import type { Marker } from "@multiplex/plex-query";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { MediaPlayerActions } from "~/types/media-player";
import { clamp, supportsFullscreen } from "../utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Main Media Player Hook
   Primary hook for media player state and actions
   ──────────────────────────────────────────────────────────── */

export function useMediaPlayer(): {
  state: ReturnType<typeof useMediaPlayerStore>;
  actions: MediaPlayerActions & {
    skipForward: (seconds?: number) => void;
    skipBackward: (seconds?: number) => void;
    jumpToStart: () => void;
    jumpToEnd: () => void;
    seekToMarkerEnd: (marker: Marker) => void;
  };
  videoRef: React.RefObject<HTMLVideoElement | null>;
} {
  const store = useMediaPlayerStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Start video playback
   */
  const play = useCallback(async () => {
    console.log("🎬 Player: play() called");
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        console.log("🎬 Player: video.play() succeeded");
        store.updatePlaybackState({ isPlaying: true });
      } catch (error) {
        console.error("🎬 Player: video.play() failed:", error);
        store.updatePlaybackState({
          error: "Failed to start video playback",
          isPlaying: false,
        });
      }
    }
  }, [store]);

  /**
   * Pause video playback
   */
  const pause = useCallback(() => {
    console.log("🎬 Player: pause() called");
    if (videoRef.current) {
      videoRef.current.pause();
      store.updatePlaybackState({ isPlaying: false });
    }
  }, [store]);

  /**
   * Toggle play/pause state
   */
  const togglePlay = useCallback(() => {
    if (store.isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [store.isPlaying, play, pause]);

  /**
   * Seek to a specific time in the video
   * @param time - Time to seek to in seconds
   */
  const seek = useCallback(
    (time: number) => {
      if (videoRef.current) {
        const clampedTime = clamp(time, 0, store.duration);
        // Plex's transcoded MP4 stream advertises an empty seekable range, so
        // assigning `video.currentTime` is silently rejected. For those we
        // seek by reloading the stream with a new `offset` instead.
        const isTranscoded = videoRef.current.currentSrc.includes(
          "/video/:/transcode/universal/",
        );
        if (isTranscoded) {
          store.updatePlaybackState({
            streamOffset: clampedTime,
            currentTime: clampedTime,
            isLoading: true,
            canPlay: false,
          });
          return;
        }
        videoRef.current.currentTime = clampedTime;
        store.updatePlaybackState({ currentTime: clampedTime });
      }
    },
    [store],
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
        store.setVolume(clampedVolume);
      }
    },
    [store],
  );

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const newMuted = !store.isMuted;
      videoRef.current.muted = newMuted;
      store.toggleMute();
    }
  }, [store]);

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
        () => store.updatePlaybackState({ isFullscreen: true }),
        (error) => console.error("Fullscreen request failed:", error),
      );
    } else {
      document.exitFullscreen().then(
        () => store.updatePlaybackState({ isFullscreen: false }),
        (error) => console.error("Exit fullscreen failed:", error),
      );
    }
  }, [store]);

  /**
   * Show controls temporarily and set timeout to hide them
   */
  const showControlsTemporarily = useCallback(() => {
    store.showControlsTemporarily();
  }, [store]);

  /**
   * Skip forward by a specified number of seconds
   * @param seconds - Number of seconds to skip forward (default: 10)
   */
  const skipForward = useCallback(
    (seconds = 10) => {
      const newTime = Math.min(store.currentTime + seconds, store.duration);
      seek(newTime);
    },
    [store.currentTime, store.duration, seek],
  );

  /**
   * Skip backward by a specified number of seconds
   * @param seconds - Number of seconds to skip backward (default: 10)
   */
  const skipBackward = useCallback(
    (seconds = 10) => {
      const newTime = Math.max(store.currentTime - seconds, 0);
      seek(newTime);
    },
    [store.currentTime, seek],
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
    seek(store.duration);
  }, [store.duration, seek]);

  /**
   * Seek to the end of a marker (for skip intro/credits functionality)
   * @param marker - The marker to skip to the end of
   */
  const seekToMarkerEnd = useCallback(
    (marker: Marker) => {
      const seekTime = marker.endTimeOffset / 1000; // Convert ms to seconds
      seek(seekTime);
    },
    [seek],
  );

  // Placeholder for openPlayer - this is handled by the store directly
  const openPlayer = useCallback(() => {
    console.warn("openPlayer should be called via store.openPlayer");
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
    closePlayer: store.closePlayer,
  };

  // Extended actions for internal use
  const extendedActions = {
    ...actions,
    skipForward,
    skipBackward,
    jumpToStart,
    jumpToEnd,
    seekToMarkerEnd,
  };

  return {
    state: store,
    actions: extendedActions,
    videoRef,
  };
}

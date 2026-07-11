"use client";

import { useCallback, useMemo, useRef } from "react";
import type { Marker } from "@multiplex/plex-query";
import { playerCommands } from "~/lib/effect/player-atoms";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type {
  MediaPlayerActions,
  MediaPlayerSeekResult,
} from "~/types/media-player";
import { clamp, supportsFullscreen } from "../utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Main Media Player Hook
   Primary hook for media player state and actions
   ──────────────────────────────────────────────────────────── */

export function useMediaPlayer(): {
  actions: MediaPlayerActions & {
    skipForward: (seconds?: number) => void;
    skipBackward: (seconds?: number) => void;
    jumpToStart: () => void;
    jumpToEnd: () => void;
    seekToMarkerEnd: (marker: Marker) => void;
  };
  videoRef: React.RefObject<HTMLVideoElement | null>;
} {
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Start video playback
   */
  const play = useCallback(async () => {
    console.log("🎬 Player: play() called");
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    const sourceGeneration = playerCommands.snapshot().sourceGeneration;
    if (video && playbackIdentity) {
      try {
        await video.play();
        if (
          videoRef.current !== video ||
          playerCommands.snapshot().sourceGeneration !== sourceGeneration
        ) {
          return false;
        }
        console.log("🎬 Player: video.play() succeeded");
        return playerCommands.updatePlaybackStateFor(playbackIdentity, {
          error: null,
          isPlaying: true,
        });
      } catch (error) {
        if (
          videoRef.current !== video ||
          playerCommands.snapshot().sourceGeneration !== sourceGeneration
        ) {
          return false;
        }
        console.error("🎬 Player: video.play() failed:", error);
        playerCommands.updatePlaybackStateFor(playbackIdentity, {
          error: "Failed to start video playback",
          isPlaying: false,
        });
        return false;
      }
    }

    return false;
  }, []);

  /**
   * Pause video playback
   */
  const pause = useCallback(() => {
    console.log("🎬 Player: pause() called");
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    if (video && playbackIdentity) {
      video.pause();
      playerCommands.updatePlaybackStateFor(playbackIdentity, {
        isPlaying: false,
      });
    }
  }, []);

  /**
   * Toggle play/pause state
   */
  const togglePlay = useCallback(() => {
    if (playerCommands.snapshot().isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [play, pause]);

  /**
   * Seek to a specific time in the video
   * @param time - Time to seek to in seconds
   */
  const seek = useCallback((time: number): MediaPlayerSeekResult => {
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    if (video && playbackIdentity) {
      const clampedTime = clamp(time, 0, playerCommands.snapshot().duration);
      // Plex's transcoded MP4 stream advertises an empty seekable range, so
      // assigning `video.currentTime` is silently rejected. For those we
      // seek by reloading the stream with a new `offset` instead.
      const isTranscoded = video.currentSrc.includes(
        "/video/:/transcode/universal/",
      );
      if (isTranscoded) {
        playerCommands.updatePlaybackStateFor(playbackIdentity, {
          streamOffset: clampedTime,
          currentTime: clampedTime,
          isLoading: true,
          canPlay: false,
        });
        return "reload";
      }
      video.currentTime = clampedTime;
      playerCommands.updatePlaybackStateFor(playbackIdentity, {
        currentTime: clampedTime,
      });
      return "direct";
    }

    return "none";
  }, []);

  /**
   * Set the volume level
   * @param volume - Volume level (0-1)
   */
  const setVolume = useCallback((volume: number) => {
    if (videoRef.current) {
      const clampedVolume = clamp(volume, 0, 1);
      videoRef.current.volume = clampedVolume;
      usePlayerPrefsStore.getState().setVolume(clampedVolume);
    }
  }, []);

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const newMuted = !usePlayerPrefsStore.getState().isMuted;
      videoRef.current.muted = newMuted;
      usePlayerPrefsStore.getState().toggleMute();
    }
  }, []);

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
        () => playerCommands.updatePlaybackState({ isFullscreen: true }),
        (error) => console.error("Fullscreen request failed:", error),
      );
    } else {
      document.exitFullscreen().then(
        () => playerCommands.updatePlaybackState({ isFullscreen: false }),
        (error) => console.error("Exit fullscreen failed:", error),
      );
    }
  }, []);

  /**
   * Skip forward by a specified number of seconds
   * @param seconds - Number of seconds to skip forward (default: 10)
   */
  const skipForward = useCallback(
    (seconds = 10) => {
      const { currentTime, duration } = playerCommands.snapshot();
      const newTime = Math.min(currentTime + seconds, duration);
      seek(newTime);
    },
    [seek],
  );

  /**
   * Skip backward by a specified number of seconds
   * @param seconds - Number of seconds to skip backward (default: 10)
   */
  const skipBackward = useCallback(
    (seconds = 10) => {
      const newTime = Math.max(
        playerCommands.snapshot().currentTime - seconds,
        0,
      );
      seek(newTime);
    },
    [seek],
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
    seek(playerCommands.snapshot().duration);
  }, [seek]);

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

  const actions = useMemo(
    () => ({
      play,
      pause,
      togglePlay,
      seek,
      setVolume,
      toggleMute,
      toggleFullscreen,
      closePlayer: playerCommands.closePlayer,
      skipForward,
      skipBackward,
      jumpToStart,
      jumpToEnd,
      seekToMarkerEnd,
    }),
    [
      jumpToEnd,
      jumpToStart,
      pause,
      play,
      seek,
      seekToMarkerEnd,
      setVolume,
      skipBackward,
      skipForward,
      toggleFullscreen,
      toggleMute,
      togglePlay,
    ],
  );

  return {
    actions,
    videoRef,
  };
}

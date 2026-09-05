"use client";

import { useEffect, useRef, useState } from "react";
import { PlaybackIntent, type Marker } from "@multiplex/plex-query";
import { playerCommands } from "~/lib/effect/player-atoms";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type {
  MediaPlayerItem,
  MediaPlayerSeekResult,
} from "~/types/media-player";
import { clamp, supportsFullscreen } from "../utils/media-player-utils";
import { clampPlayableSeekTarget } from "../utils/playback-time-utils";
import {
  buildPlexPlaybackPlan,
  playbackUsesTranscode,
} from "../utils/plex-playback-plan";
import {
  buildPlexTranscodeSessionKey,
  markTranscodeSessionStopped,
  stopTranscodeSessionBeforeReplacement,
} from "../utils/plex-stream-urls";
import { emitMediaPlayerDiagnostic } from "../utils/media-player-diagnostics";

const TRANSCODE_SEEK_COALESCE_MS = 200;

export function getMediaSeekResult(
  item: MediaPlayerItem | null,
): Exclude<MediaPlayerSeekResult, "none"> {
  return item !== null && playbackUsesTranscode(item) ? "reload" : "direct";
}

export function detachMediaForReplacement(
  video: Pick<HTMLVideoElement, "load" | "pause" | "removeAttribute">,
): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

export function getMediaToggleAction(
  video: Pick<HTMLVideoElement, "paused"> | null,
  stateIsPlaying: boolean,
): "play" | "pause" {
  if (video) return video.paused ? "play" : "pause";
  return stateIsPlaying ? "pause" : "play";
}

function toggleFullscreen() {
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
}

/* ────────────────────────────────────────────────────────────
   Main Media Player Hook
   Primary hook for media player state and actions
   ──────────────────────────────────────────────────────────── */

export function useMediaPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackIntent] = useState(PlaybackIntent.make);
  const pauseRequestedRef = useRef(false);
  const transcodeSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const transcodeSeekRevisionRef = useRef(0);

  const cancelPendingTranscodeSeek = () => {
    transcodeSeekRevisionRef.current += 1;
    if (transcodeSeekTimeoutRef.current !== null) {
      clearTimeout(transcodeSeekTimeoutRef.current);
      transcodeSeekTimeoutRef.current = null;
    }
  };

  useEffect(() => cancelPendingTranscodeSeek, []);

  /**
   * Start video playback
   */
  const play = async () => {
    console.log("🎬 Player: play() called");
    emitMediaPlayerDiagnostic({ kind: "play-command" });
    pauseRequestedRef.current = false;
    const intentRevision = playbackIntent.beginPlay();
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    const sourceGeneration = playerCommands.snapshot().sourceGeneration;
    if (video && playbackIdentity) {
      try {
        await video.play();
        if (!playbackIntent.isCurrent(intentRevision)) {
          if (!playbackIntent.shouldPlay()) video.pause();
          return false;
        }
        if (
          videoRef.current !== video ||
          playerCommands.snapshot().sourceGeneration !== sourceGeneration
        ) {
          return false;
        }
        console.log("🎬 Player: video.play() succeeded");
        emitMediaPlayerDiagnostic({ kind: "play-succeeded" });
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
        emitMediaPlayerDiagnostic({ kind: "play-failed" });
        playerCommands.updatePlaybackStateFor(playbackIdentity, {
          error: "Failed to start video playback",
          isPlaying: false,
        });
        return false;
      }
    }

    return false;
  };

  /**
   * Pause video playback
   */
  const pause = () => {
    console.log("🎬 Player: pause() called");
    emitMediaPlayerDiagnostic({ kind: "pause-command" });
    playbackIntent.pause();
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    if (video && playbackIdentity) {
      pauseRequestedRef.current = !video.paused;
      video.pause();
      playerCommands.updatePlaybackStateFor(playbackIdentity, {
        isPlaying: false,
      });
    }
  };

  const consumePauseRequest = () => {
    const requested = pauseRequestedRef.current;
    pauseRequestedRef.current = false;
    return requested;
  };

  const prepareForReplacement = () => {
    cancelPendingTranscodeSeek();
    playbackIntent.pause();
    pauseRequestedRef.current = false;
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    if (!video || !playbackIdentity) return;

    emitMediaPlayerDiagnostic({
      kind: "replacement-prepared",
      currentTimeSeconds: video.currentTime,
      sourceGeneration: playerCommands.snapshot().sourceGeneration,
    });

    playerCommands.updatePlaybackStateFor(playbackIdentity, {
      isLoading: true,
      isPreparingReplacement: true,
      canPlay: false,
      isPlaying: false,
    });
    detachMediaForReplacement(video);
  };

  /**
   * Toggle play/pause state
   */
  const togglePlay = () => {
    if (
      getMediaToggleAction(
        videoRef.current,
        playerCommands.snapshot().isPlaying,
      ) === "pause"
    ) {
      pause();
    } else {
      void play();
    }
  };

  /**
   * Seek to a specific time in the video
   * @param time - Time to seek to in seconds
   */
  const seek = (time: number): MediaPlayerSeekResult => {
    const video = videoRef.current;
    const playbackIdentity = playerCommands.playbackIdentity();
    if (!playbackIdentity) return "none";

    const playerState = playerCommands.snapshot();
    const duration = playerState.duration;
    // An exact EOF seek is not a playable media position. Native MP4s can
    // report `ended` and snap their timeline back before Watch Together has
    // propagated the seek, while Plex rejects an EOF transcode offset.
    // Keep every seek inside the same final half-second used by autoplay and
    // room rotation so both playback paths have identical semantics.
    const clampedTime = clampPlayableSeekTarget(
      clamp(time, 0, duration),
      duration,
    );
    // Plex's transcoded MP4 stream advertises an empty seekable range, so
    // assigning `video.currentTime` is silently rejected. For those we
    // seek by reloading the stream with a new `offset` instead.
    // Use the canonical playback plan. Chrome can clear `currentSrc` while
    // replacing a transcode source, which must not turn the seek into a
    // rejected native media-element seek.
    const seekResult = getMediaSeekResult(playerState.currentItem);
    emitMediaPlayerDiagnostic({
      kind: "seek-requested",
      requestedTimeSeconds: time,
      targetTimeSeconds: clampedTime,
      durationSeconds: duration,
      result: seekResult,
      sourceGeneration: playerState.sourceGeneration,
      wasPreparingReplacement: playerState.isPreparingReplacement,
    });
    if (seekResult === "reload") {
      const playableTime = clampedTime;
      cancelPendingTranscodeSeek();
      const seekRevision = transcodeSeekRevisionRef.current;
      playerCommands.updatePlaybackStateFor(playbackIdentity, {
        currentTime: playableTime,
        isLoading: true,
        isPreparingReplacement: true,
        canPlay: false,
      });
      if (video && !playerState.isPreparingReplacement) {
        emitMediaPlayerDiagnostic({
          kind: "transcode-source-detached",
          targetTimeSeconds: playableTime,
          sourceGeneration: playerState.sourceGeneration,
        });
        detachMediaForReplacement(video);
      }
      emitMediaPlayerDiagnostic({
        kind: "transcode-replacement-scheduled",
        targetTimeSeconds: playableTime,
        seekRevision,
      });
      transcodeSeekTimeoutRef.current = setTimeout(() => {
        transcodeSeekTimeoutRef.current = null;
        void (async () => {
          const pending = playerCommands.snapshot();
          const pendingItem = pending.currentItem;
          if (
            pendingItem?.serverUrl &&
            pendingItem.authToken &&
            pending.transcodeSessionId
          ) {
            const plan = buildPlexPlaybackPlan(pendingItem);
            const sessionKey = buildPlexTranscodeSessionKey(
              pending.transcodeSessionId,
              pending.streamOffset,
              plan,
              pending.transcodeAttempt,
            );
            const stopped = await stopTranscodeSessionBeforeReplacement(
              pendingItem.serverUrl,
              pendingItem.authToken,
              sessionKey,
            );
            emitMediaPlayerDiagnostic({
              kind: "transcode-previous-session-stop-completed",
              stopped,
              targetTimeSeconds: playableTime,
              seekRevision,
            });
            if (stopped) markTranscodeSessionStopped(sessionKey);
          }
          if (transcodeSeekRevisionRef.current !== seekRevision) {
            emitMediaPlayerDiagnostic({
              kind: "transcode-replacement-cancelled",
              targetTimeSeconds: playableTime,
              seekRevision,
            });
            return;
          }
          emitMediaPlayerDiagnostic({
            kind: "transcode-replacement-committed",
            targetTimeSeconds: playableTime,
            seekRevision,
          });
          playerCommands.replaceTranscodeSource(playbackIdentity, playableTime);
        })();
      }, TRANSCODE_SEEK_COALESCE_MS);
      return seekResult;
    }

    if (!video) return "none";

    video.currentTime = clampedTime;
    playerCommands.updatePlaybackStateFor(playbackIdentity, {
      currentTime: clampedTime,
    });
    return seekResult;
  };

  /**
   * Set the volume level
   * @param volume - Volume level (0-1)
   */
  const setVolume = (volume: number) => {
    if (videoRef.current) {
      const clampedVolume = clamp(volume, 0, 1);
      videoRef.current.volume = clampedVolume;
      usePlayerPrefsStore.getState().setVolume(clampedVolume);
    }
  };

  const setPlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video || video.playbackRate === rate) return;
    video.playbackRate = rate;
    emitMediaPlayerDiagnostic({
      kind: "syncplay-playback-rate-changed",
      rate,
    });
  };

  /**
   * Toggle mute state
   */
  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !usePlayerPrefsStore.getState().isMuted;
      videoRef.current.muted = newMuted;
      usePlayerPrefsStore.getState().toggleMute();
    }
  };

  /**
   * Skip forward by a specified number of seconds
   * @param seconds - Number of seconds to skip forward (default: 10)
   */
  const skipForward = (seconds = 10) => {
    const { currentTime, duration } = playerCommands.snapshot();
    const newTime = Math.min(currentTime + seconds, duration);
    return seek(newTime);
  };

  /**
   * Skip backward by a specified number of seconds
   * @param seconds - Number of seconds to skip backward (default: 10)
   */
  const skipBackward = (seconds = 10) => {
    const newTime = Math.max(
      playerCommands.snapshot().currentTime - seconds,
      0,
    );
    return seek(newTime);
  };

  /**
   * Jump to the beginning of the video
   */
  const jumpToStart = () => {
    return seek(0);
  };

  /**
   * Jump to the end of the video
   */
  const jumpToEnd = () => {
    return seek(playerCommands.snapshot().duration);
  };

  /**
   * Seek to the end of a marker (for skip intro/credits functionality)
   * @param marker - The marker to skip to the end of
   */
  const seekToMarkerEnd = (marker: Marker) => {
    const seekTime = marker.endTimeOffset / 1000; // Convert ms to seconds
    return seek(seekTime);
  };

  const actions = {
    play,
    pause,
    togglePlay,
    seek,
    setPlaybackRate,
    setVolume,
    toggleMute,
    toggleFullscreen,
    closePlayer: playerCommands.closePlayer,
    skipForward,
    skipBackward,
    jumpToStart,
    jumpToEnd,
    seekToMarkerEnd,
  };

  return {
    actions,
    videoRef,
    consumePauseRequest,
    prepareForReplacement,
  };
}

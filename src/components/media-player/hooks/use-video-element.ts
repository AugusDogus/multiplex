"use client";

import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { updatePlaybackStateAtom } from "~/atoms/media-player";
import { getVideoElementError } from "../utils/media-player-utils";

/* ────────────────────────────────────────────────────────────
   Video Element Hook
   Manages video element events and state synchronization
   ──────────────────────────────────────────────────────────── */

interface UseVideoElementOptions {
  /**
   * Callback fired when the video time updates
   */
  onTimeUpdate?: (currentTime: number) => void;
  /**
   * Callback fired when the video ends
   */
  onEnded?: () => void;
  /**
   * Callback fired when video starts playing
   */
  onPlay?: () => void;
  /**
   * Callback fired when video is paused
   */
  onPause?: () => void;
  /**
   * Callback fired when video metadata is loaded
   */
  onLoadedMetadata?: () => void;
}

export function useVideoElement(
  videoRef: React.RefObject<HTMLVideoElement>,
  options: UseVideoElementOptions = {},
) {
  const { onTimeUpdate, onEnded, onPlay, onPause, onLoadedMetadata } = options;
  const [, updateState] = useAtom(updatePlaybackStateAtom);

  /**
   * Handle video metadata loaded event
   */
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      updateState({
        duration: videoRef.current.duration,
        canPlay: true,
        isLoading: false,
      });
      onLoadedMetadata?.();
    }
  }, [updateState, videoRef, onLoadedMetadata]);

  /**
   * Handle video time update event
   */
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const currentTime = videoRef.current.currentTime;
      updateState({ currentTime });
      onTimeUpdate?.(currentTime);
    }
  }, [updateState, videoRef, onTimeUpdate]);

  /**
   * Handle video progress event (buffering)
   */
  const handleProgress = useCallback(() => {
    if (videoRef.current && videoRef.current.buffered.length > 0) {
      const bufferedTime = videoRef.current.buffered.end(
        videoRef.current.buffered.length - 1,
      );
      updateState({ bufferedTime });
    }
  }, [updateState, videoRef]);

  /**
   * Handle video waiting event (buffering starts)
   */
  const handleWaiting = useCallback(() => {
    updateState({ isBuffering: true });
  }, [updateState]);

  /**
   * Handle video can play event (buffering ends)
   */
  const handleCanPlay = useCallback(() => {
    updateState({ isBuffering: false, canPlay: true });
  }, [updateState]);

  /**
   * Handle video can play through event (enough data loaded)
   */
  const handleCanPlayThrough = useCallback(() => {
    updateState({
      isBuffering: false,
      canPlay: true,
      isLoading: false,
    });
  }, [updateState]);

  /**
   * Handle video error event
   */
  const handleError = useCallback(() => {
    if (videoRef.current?.error) {
      const errorMessage = getVideoElementError(videoRef.current.error);
      updateState({
        error: errorMessage,
        isLoading: false,
        isBuffering: false,
      });
    }
  }, [updateState, videoRef]);

  /**
   * Handle video play event
   */
  const handlePlay = useCallback(() => {
    updateState({ isPlaying: true });
    onPlay?.();
  }, [updateState, onPlay]);

  /**
   * Handle video pause event
   */
  const handlePause = useCallback(() => {
    updateState({ isPlaying: false });
    onPause?.();
  }, [updateState, onPause]);

  /**
   * Handle video ended event
   */
  const handleEnded = useCallback(() => {
    updateState({ isPlaying: false });
    onEnded?.();
  }, [updateState, onEnded]);

  /**
   * Handle volume change event
   */
  const handleVolumeChange = useCallback(() => {
    if (videoRef.current) {
      updateState({
        volume: videoRef.current.volume,
        isMuted: videoRef.current.muted,
      });
    }
  }, [updateState, videoRef]);

  /**
   * Handle video load start event
   */
  const handleLoadStart = useCallback(() => {
    updateState({
      isLoading: true,
      error: null,
      canPlay: false,
    });
  }, [updateState]);

  /**
   * Handle video loaded data event
   */
  const handleLoadedData = useCallback(() => {
    updateState({
      isLoading: false,
      canPlay: true,
    });
  }, [updateState]);

  /**
   * Handle video seeking event
   */
  const handleSeeking = useCallback(() => {
    updateState({ isBuffering: true });
  }, [updateState]);

  /**
   * Handle video seeked event
   */
  const handleSeeked = useCallback(() => {
    updateState({ isBuffering: false });
  }, [updateState]);

  /**
   * Handle video duration change event
   */
  const handleDurationChange = useCallback(() => {
    if (videoRef.current) {
      updateState({ duration: videoRef.current.duration });
    }
  }, [updateState, videoRef]);

  /**
   * Handle video stalled event (data flow has stopped)
   */
  const handleStalled = useCallback(() => {
    updateState({ isBuffering: true });
  }, [updateState]);

  /**
   * Handle video suspend event (loading has been suspended)
   */
  const handleSuspend = useCallback(() => {
    updateState({ isBuffering: false });
  }, [updateState]);

  /**
   * Attach all video event listeners
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Playback events
    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("canplaythrough", handleCanPlayThrough);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    // Progress events
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("durationchange", handleDurationChange);

    // Seeking events
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("seeked", handleSeeked);

    // Buffering events
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("suspend", handleSuspend);

    // Audio events
    video.addEventListener("volumechange", handleVolumeChange);

    // Error events
    video.addEventListener("error", handleError);

    return () => {
      // Clean up all event listeners
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("canplaythrough", handleCanPlayThrough);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("suspend", handleSuspend);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("error", handleError);
    };
  }, [
    handleLoadStart,
    handleLoadedData,
    handleLoadedMetadata,
    handleCanPlay,
    handleCanPlayThrough,
    handlePlay,
    handlePause,
    handleEnded,
    handleTimeUpdate,
    handleProgress,
    handleDurationChange,
    handleSeeking,
    handleSeeked,
    handleWaiting,
    handleStalled,
    handleSuspend,
    handleVolumeChange,
    handleError,
    videoRef,
  ]);

  return {
    // All event handlers are attached via useEffect
    // This hook doesn't return anything as it's purely for side effects
  };
}

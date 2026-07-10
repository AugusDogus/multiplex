"use client";

import { useCallback, useRef, type RefObject } from "react";
import { playerCommands } from "~/lib/effect/player-atoms";

const RESUME_SEEK_TOLERANCE_SEC = 0.5;

function isResumeSeekComplete(localTime: number, targetTime: number): boolean {
  return Math.abs(localTime - targetTime) < RESUME_SEEK_TOLERANCE_SEC;
}

interface UseResumePlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  usesOffsetTimeline: boolean;
  streamOffset: number;
  isLoading: boolean;
  updatePlaybackState: (updates: {
    currentTime?: number;
    isLoading?: boolean;
    isBuffering?: boolean;
  }) => void;
  onVideoTimeUpdate?: (currentTime: number) => void;
  onVideoSeeked?: (currentTime: number) => void;
}

export function useResumePlayback({
  videoRef,
  usesOffsetTimeline,
  streamOffset,
  isLoading,
  updatePlaybackState,
  onVideoTimeUpdate,
  onVideoSeeked,
}: UseResumePlaybackOptions) {
  const pendingResumeTimeRef = useRef<number | null>(null);

  const getEffectiveTime = useCallback(
    (localTime: number) =>
      usesOffsetTimeline ? streamOffset + localTime : localTime,
    [streamOffset, usesOffsetTimeline],
  );

  const captureResumeTimeOnLoadStart = useCallback(() => {
    const storeCurrentTime = playerCommands.snapshot().currentTime;
    if (!usesOffsetTimeline && storeCurrentTime > 0) {
      pendingResumeTimeRef.current = storeCurrentTime;
    }
  }, [usesOffsetTimeline]);

  const applyResumeSeekOnMetadata = useCallback(
    (video: HTMLVideoElement) => {
      const storeCurrentTime = playerCommands.snapshot().currentTime;
      const startTime = pendingResumeTimeRef.current ?? storeCurrentTime;
      const needsResumeSeek = !usesOffsetTimeline && startTime > 0;

      if (needsResumeSeek) {
        pendingResumeTimeRef.current = startTime;
        video.currentTime = startTime;
      }

      return { needsResumeSeek, startTime };
    },
    [usesOffsetTimeline],
  );

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const pendingResumeTime = pendingResumeTimeRef.current;
    if (pendingResumeTime !== null) {
      if (isResumeSeekComplete(video.currentTime, pendingResumeTime)) {
        pendingResumeTimeRef.current = null;
        updatePlaybackState({
          isLoading: false,
          currentTime: video.currentTime,
        });
      }
      return;
    }

    if (isLoading) return;

    const effectiveTime = getEffectiveTime(video.currentTime);
    updatePlaybackState({ currentTime: effectiveTime });
    onVideoTimeUpdate?.(effectiveTime);
  }, [
    getEffectiveTime,
    isLoading,
    onVideoTimeUpdate,
    updatePlaybackState,
    videoRef,
  ]);

  const handleSeeked = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const pendingResumeTime = pendingResumeTimeRef.current;
    if (
      pendingResumeTime !== null &&
      !usesOffsetTimeline &&
      !isResumeSeekComplete(video.currentTime, pendingResumeTime)
    ) {
      return;
    }

    const effectiveTime = getEffectiveTime(video.currentTime);
    if (pendingResumeTime !== null) {
      pendingResumeTimeRef.current = null;
    }

    updatePlaybackState({
      isBuffering: false,
      isLoading: false,
      currentTime: effectiveTime,
    });
    onVideoSeeked?.(effectiveTime);
  }, [
    getEffectiveTime,
    onVideoSeeked,
    updatePlaybackState,
    usesOffsetTimeline,
    videoRef,
  ]);

  const hasPendingResume = useCallback(
    () => pendingResumeTimeRef.current !== null,
    [],
  );

  return {
    captureResumeTimeOnLoadStart,
    applyResumeSeekOnMetadata,
    handleTimeUpdate,
    handleSeeked,
    hasPendingResume,
  };
}

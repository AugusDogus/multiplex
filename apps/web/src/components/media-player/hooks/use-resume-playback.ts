"use client";

import { useEffect, useRef, type RefObject } from "react";
import { playerCommands } from "~/lib/effect/player-atoms";

const RESUME_SEEK_TOLERANCE_SEC = 0.5;

function isResumeSeekComplete(localTime: number, targetTime: number): boolean {
  return Math.abs(localTime - targetTime) < RESUME_SEEK_TOLERANCE_SEC;
}

interface UseResumePlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  playbackGeneration: string;
  sourceGeneration: number;
  usesOffsetTimeline: boolean;
  streamOffset: number;
  isLoading: boolean;
  updatePlaybackState: (updates: {
    currentTime?: number;
    isLoading?: boolean;
    isBuffering?: boolean;
  }) => boolean;
  onVideoTimeUpdate?: (currentTime: number) => void;
  onVideoSeeked?: (currentTime: number) => void;
}

export function useResumePlayback({
  videoRef,
  playbackGeneration,
  sourceGeneration,
  usesOffsetTimeline,
  streamOffset,
  isLoading,
  updatePlaybackState,
  onVideoTimeUpdate,
  onVideoSeeked,
}: UseResumePlaybackOptions) {
  const pendingResumeTimeRef = useRef<{
    playbackGeneration: string;
    sourceGeneration: number;
    time: number;
  } | null>(null);

  useEffect(() => {
    pendingResumeTimeRef.current = null;
  }, [playbackGeneration, sourceGeneration]);

  const isCurrentSource = () => {
    const current = playerCommands.snapshot();
    return (
      current.streamSessionId === playbackGeneration &&
      current.sourceGeneration === sourceGeneration
    );
  };

  const getEffectiveTime = (localTime: number) =>
    usesOffsetTimeline ? streamOffset + localTime : localTime;

  const captureResumeTimeOnLoadStart = () => {
    if (!isCurrentSource()) return;

    const storeCurrentTime = playerCommands.snapshot().currentTime;
    if (!usesOffsetTimeline && storeCurrentTime > 0) {
      pendingResumeTimeRef.current = {
        playbackGeneration,
        sourceGeneration,
        time: storeCurrentTime,
      };
    }
  };

  const applyResumeSeekOnMetadata = (video: HTMLVideoElement) => {
    if (!isCurrentSource()) {
      return { needsResumeSeek: false, startTime: 0 };
    }

    const storeCurrentTime = playerCommands.snapshot().currentTime;
    const pendingResumeTime =
      pendingResumeTimeRef.current?.playbackGeneration === playbackGeneration &&
      pendingResumeTimeRef.current.sourceGeneration === sourceGeneration
        ? pendingResumeTimeRef.current.time
        : null;
    const startTime = pendingResumeTime ?? storeCurrentTime;
    const needsResumeSeek = !usesOffsetTimeline && startTime > 0;

    if (needsResumeSeek) {
      pendingResumeTimeRef.current = {
        playbackGeneration,
        sourceGeneration,
        time: startTime,
      };
      video.currentTime = startTime;
    }

    return { needsResumeSeek, startTime };
  };

  const handleTimeUpdate = () => {
    if (!isCurrentSource()) return;

    const video = videoRef.current;
    if (!video) return;

    const pendingResumeTime =
      pendingResumeTimeRef.current?.playbackGeneration === playbackGeneration &&
      pendingResumeTimeRef.current.sourceGeneration === sourceGeneration
        ? pendingResumeTimeRef.current.time
        : null;
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
    if (updatePlaybackState({ currentTime: effectiveTime })) {
      onVideoTimeUpdate?.(effectiveTime);
    }
  };

  const handleSeeked = () => {
    if (!isCurrentSource()) return;

    const video = videoRef.current;
    if (!video) return;

    const pendingResumeTime =
      pendingResumeTimeRef.current?.playbackGeneration === playbackGeneration &&
      pendingResumeTimeRef.current.sourceGeneration === sourceGeneration
        ? pendingResumeTimeRef.current.time
        : null;
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

    const updated = updatePlaybackState({
      isBuffering: false,
      isLoading: false,
      currentTime: effectiveTime,
    });
    if (updated) onVideoSeeked?.(effectiveTime);
  };

  const hasPendingResume = () =>
    pendingResumeTimeRef.current?.playbackGeneration === playbackGeneration &&
    pendingResumeTimeRef.current.sourceGeneration === sourceGeneration;

  return {
    captureResumeTimeOnLoadStart,
    applyResumeSeekOnMetadata,
    handleTimeUpdate,
    handleSeeked,
    hasPendingResume,
  };
}

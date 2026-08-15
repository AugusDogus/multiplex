"use client";

import { useEffect } from "react";
import { rotationCountdown } from "@multiplex/plex-query";

import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import { shallow } from "zustand/shallow";
import type { NextEpisodeInfo } from "~/types/media-player";

interface UseWatchTogetherRotationOptions {
  /** True while a Watch Together session drives the current item. */
  enabled: boolean;
  /** Next episode in the play queue (from {@link useAutoPlayNextEpisode}). */
  nextEpisode: NextEpisodeInfo | null;
}

/**
 * React glue for Watch Together auto-advance: pushes play-queue next-episode
 * discovery + the Auto Play toggle into {@link WatchTogetherSession} and
 * derives the countdown overlay from session rotation phase.
 *
 * Lobby URL follow after a room swap lives in
 * {@link WatchTogetherSessionShell} (layout-stable soft-nav).
 */
export function useWatchTogetherRotation({
  enabled,
  nextEpisode,
}: UseWatchTogetherRotationOptions) {
  const sessionState = useSessionState();
  const { currentTime, duration } = usePlayerStateSelector(
    (state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
    }),
    shallow,
  );
  const playing =
    enabled && sessionState._tag === "Playing" ? sessionState : null;

  // Episode handoff is a room-level decision. A persisted preference on one
  // browser must not leave that viewer behind while the room rotates. The
  // preference continues to control solo autoplay only.
  useEffect(() => {
    sessionCommands.setRotationContext({
      nextEpisode: enabled ? nextEpisode : null,
      autoPlayEnabled: enabled,
    });
  }, [enabled, nextEpisode]);

  const timeRemaining =
    duration > 0 ? duration - currentTime : Number.POSITIVE_INFINITY;

  if (!playing) {
    return {
      isCountingDown: false,
      countdownSeconds: 0,
      nextEpisode: null as NextEpisodeInfo | null,
    };
  }

  const { isCountingDown, countdownSeconds } = rotationCountdown({
    phase: playing.rotation,
    timeRemainingSeconds: timeRemaining,
  });

  return {
    isCountingDown,
    countdownSeconds,
    nextEpisode: playing.rotation._tag !== "None" ? nextEpisode : null,
  };
}

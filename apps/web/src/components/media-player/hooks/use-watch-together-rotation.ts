"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { rotationCountdown } from "@multiplex/plex-query";

import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { NextEpisodeInfo } from "~/types/media-player";

interface UseWatchTogetherRotationOptions {
  /** True while a Watch Together session drives the current item. */
  enabled: boolean;
  /** Next episode in the play queue (from {@link useAutoPlayNextEpisode}). */
  nextEpisode: NextEpisodeInfo | null;
}

/**
 * React glue for Watch Together auto-advance: pushes play-queue next-episode
 * discovery + the Auto Play toggle into {@link WatchTogetherSession}, derives
 * the countdown overlay from session rotation phase, and follows the lobby URL
 * after a room swap.
 */
export function useWatchTogetherRotation({
  enabled,
  nextEpisode,
}: UseWatchTogetherRotationOptions) {
  const sessionState = useSessionState();
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const autoPlayEnabled = useMediaPlayerStore(
    (state) => state.autoPlay.isEnabled,
  );
  const router = useRouter();

  const playing =
    enabled && sessionState._tag === "Playing" ? sessionState : null;

  // The player-settings "Auto Play" toggle deliberately gates Watch Together
  // auto-advance too: the group countdown has no cancel button, so the toggle
  // is a viewer's only way to opt out of being carried into the next episode.
  useEffect(() => {
    sessionCommands.setRotationContext({
      nextEpisode: enabled ? nextEpisode : null,
      autoPlayEnabled: enabled && autoPlayEnabled,
    });
  }, [enabled, nextEpisode, autoPlayEnabled]);

  // The page under the modal is usually the previous room's lobby, which is
  // now gone after a swap. Silently move it to the next room's lobby (the
  // modal stays on top, so nothing flashes), so closing the player later
  // doesn't strand the viewer on a dead room page. (One-shot imperative check
  // — window.location rather than usePathname(), which the statically
  // prerendered root layout can't read outside a Suspense boundary.)
  const previousRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!playing) {
      previousRoomIdRef.current = null;
      return;
    }
    const roomId = playing.room.id;
    const previous = previousRoomIdRef.current;
    previousRoomIdRef.current = roomId;
    if (previous && previous !== roomId) {
      if (window.location.pathname === getWatchTogetherRoomHref(previous)) {
        router.replace(getWatchTogetherRoomHref(roomId));
      }
    }
  }, [playing, router]);

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

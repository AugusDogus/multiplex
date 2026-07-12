"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { rotationCountdown } from "@multiplex/plex-query";

import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
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
 * discovery + the Auto Play toggle into {@link WatchTogetherSession}, derives
 * the countdown overlay from session rotation phase, and follows the lobby URL
 * after a room swap.
 */
export function useWatchTogetherRotation({
  enabled,
  nextEpisode,
}: UseWatchTogetherRotationOptions) {
  const router = useRouter();
  const sessionState = useSessionState();
  const { currentTime, duration } = usePlayerStateSelector(
    (state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
    }),
    shallow,
  );
  const autoPlayEnabled = usePlayerPrefsStore((state) => state.autoPlayEnabled);

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
  // doesn't strand the viewer on a dead room page.
  //
  // Use Next.js router.replace (not history.replaceState) so the App Router
  // segment matches the live room — otherwise Leave/exitLobby still see the
  // stale roomId param and no-op. Path is read from window.location rather
  // than usePathname(), which the statically prerendered root layout can't
  // read outside a Suspense boundary.
  const previousRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!playing) {
      previousRoomIdRef.current = null;
      return;
    }
    const nextRoomId = playing.room.id;
    const previous = previousRoomIdRef.current;
    previousRoomIdRef.current = nextRoomId;
    if (!previous || previous === nextRoomId) {
      return;
    }
    const path = window.location.pathname;
    const onPreviousLobby = path === getWatchTogetherRoomHref(previous);
    const onAnyWatchTogetherLobby = path.startsWith("/watch-together/");
    if (onPreviousLobby || onAnyWatchTogetherLobby) {
      const href = getWatchTogetherRoomHref(nextRoomId);
      // Replace the address bar immediately so Playwright/assertions and any
      // code reading window.location see the live room without waiting on the
      // App Router soft-navigation. Also notify Next so the [roomId] segment
      // remounts against the live room (Leave/exitLobby expectedRoomId guards).
      window.history.replaceState(window.history.state, "", href);
      router.replace(href);
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

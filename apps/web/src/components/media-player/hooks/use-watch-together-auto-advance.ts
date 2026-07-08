"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SyncplayClient,
  type SyncplayParticipantState,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import {
  findNextEpisodeRoom,
  getAutoAdvanceRank,
  haveMultiplexParticipantsJoined,
  mergeParticipantState,
} from "~/components/watch-together/watch-together-auto-advance";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";
import { api } from "~/trpc/react";

/* ────────────────────────────────────────────────────────────
   Watch Together Auto-Advance Hook

   "Continue watching" for Watch Together sessions, with no extra backend:
   Plex's together.plex.tv rooms are single-item, so advancing to the next
   episode means rotating the whole party into a fresh room. The trick is
   that the invite itself is the coordination channel — every Multiplex
   client runs the same deterministic protocol against shared state:

   1. Nearing the episode's end, clients elect a leader (lowest Plex user
      id / device id among Multiplex participants). The leader creates a
      room for the next episode, inviting everyone from the current room.
      Higher ranks act as staggered failovers if no room appears.
   2. The invite makes the new room show up in every member's own room
      list, so the others discover it by polling — no side channel needed.
   3. When the episode ends, each Multiplex client joins the next room's
      Syncplay as a silent observer ("joined the lobby"), waits for the
      rest of the party (or a short grace period), then swaps the player
      to the next episode in place — the modal never closes and no lobby
      page is shown.

   Official Plex clients in the party can't run this protocol; for them
   the rotation degrades gracefully to the standard flow — they receive a
   normal Watch Together invite and join the new room's lobby like any
   other session, which is exactly how the official app behaves today.
   ──────────────────────────────────────────────────────────── */

// How early (seconds remaining) the rotation protocol arms: the leader
// creates the next room and everyone starts looking for it, so it's ready
// well before the credits finish.
const ADVANCE_LEAD_SECONDS = 45;
// Ignore the first moments of playback, where duration/position aren't
// settled yet (mirrors the solo autoplay guard).
const MIN_PLAYBACK_SECONDS = 5;
// "Effectively at the end" threshold, same as solo autoplay.
const END_THRESHOLD_SECONDS = 0.5;
// The countdown overlay window (mirrors the solo autoplay overlay).
const COUNTDOWN_SECONDS = 5;
// Room-list polling cadence while looking for the next room.
const DISCOVERY_POLL_MS = 4_000;
// Rank 0 waits this long before creating, so the first discovery poll can
// surface a room another client already created (e.g. we armed late).
const CREATE_BASE_DELAY_MS = 1_500;
// Per-rank delay before a failover candidate creates the room itself. Must
// comfortably exceed the discovery poll, so a failover only fires when the
// leader genuinely didn't deliver.
const CREATE_STAGGER_MS = 8_000;
// After the episode ends, how long to wait for the rest of the party to
// appear in the next room before swapping anyway (a stuck participant must
// not strand everyone on the end screen).
const EVERYONE_JOINED_GRACE_MS = 10_000;
// Reconnect delay for the background observer connection.
const OBSERVER_RECONNECT_DELAY_MS = 2_000;

interface UseWatchTogetherAutoAdvanceOptions {
  /** True while a Watch Together session drives the current item. */
  enabled: boolean;
  /** Next episode in the play queue (from {@link useAutoPlayNextEpisode}). */
  nextEpisode: NextEpisodeInfo | null;
}

export function useWatchTogetherAutoAdvance({
  enabled,
  nextEpisode,
}: UseWatchTogetherAutoAdvanceOptions) {
  const session = useWatchTogetherStore((state) => state.session);
  const participants = useWatchTogetherStore((state) => state.participants);
  const setSession = useWatchTogetherStore((state) => state.setSession);
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const autoPlayEnabled = useMediaPlayerStore(
    (state) => state.autoPlay.isEnabled,
  );
  const utils = api.useUtils();
  const router = useRouter();

  const localUser = session?.localUser ?? null;
  // The player-settings "Auto Play" toggle deliberately gates Watch Together
  // auto-advance too: the group countdown has no cancel button, so the toggle
  // is a viewer's only way to opt out of being carried into the next episode.
  // An opted-out viewer simply stops at the episode's end (like the official
  // client) while the rest of the party rotates without them — leader
  // election's staggered failover covers the case where the opted-out viewer
  // would have been the leader.
  const active = Boolean(
    enabled &&
      session &&
      autoPlayEnabled &&
      currentItem?.type === "episode" &&
      nextEpisode,
  );

  // One rotation cycle per (room, episode, next episode) triple; a key change
  // (most importantly: the swap itself) starts a fresh, disarmed cycle.
  const advanceKey =
    active && session && currentItem && nextEpisode
      ? `${session.room.id}:${currentItem.ratingKey}:${nextEpisode.ratingKey}`
      : null;

  const timeRemaining =
    duration > 0 ? duration - currentTime : Number.POSITIVE_INFINITY;
  const inLeadWindow =
    duration > 0 &&
    currentTime > MIN_PLAYBACK_SECONDS &&
    timeRemaining >= 0 &&
    timeRemaining <= ADVANCE_LEAD_SECONDS;
  const atEnd = duration > 0 && timeRemaining <= END_THRESHOLD_SECONDS;

  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [nextRoom, setNextRoom] = useState<WatchTogetherRoom | null>(null);
  const [nextRoomParticipants, setNextRoomParticipants] = useState<
    Record<string, SyncplayParticipantState>
  >({});
  const [graceElapsed, setGraceElapsed] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const hasAttemptedCreateRef = useRef(false);
  // Bumped when a create fails, so the creation effect re-runs and schedules
  // a retry (clearing the ref alone wouldn't trigger a render).
  const [createRetryToken, setCreateRetryToken] = useState(0);

  const armed = advanceKey !== null && armedKey === advanceKey;

  // Arm once playback crosses into the lead window. Latched for the rest of
  // the episode (a seek back out of the window must not restart the protocol
  // — the room, once created, stays valid until the episode actually ends).
  useEffect(() => {
    if (!advanceKey || !inLeadWindow || armedKey === advanceKey) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latching a playback-time threshold crossing is inherently an effect
    setArmedKey(advanceKey);
    setNextRoom(null);
    setNextRoomParticipants({});
    setGraceElapsed(false);
    setSwapped(false);
    hasAttemptedCreateRef.current = false;
  }, [advanceKey, inLeadWindow, armedKey]);

  // Discovery: the next room is invited to everyone in the current room, so
  // it appears in each member's own room list — poll until the swap. Polling
  // continues even after a room has been adopted (and the creator learns its
  // own room through this same path, not from the create response): if a
  // failover raced the leader into creating a duplicate, every client keeps
  // re-evaluating the deterministic winner and converges on the same room
  // instead of the party splitting across duplicates.
  const roomsQuery = api.plex.getWatchTogetherRooms.useQuery(undefined, {
    enabled: armed && !swapped,
    refetchInterval: DISCOVERY_POLL_MS,
    staleTime: 0,
  });
  const rooms = roomsQuery.data;

  useEffect(() => {
    if (
      !armed ||
      swapped ||
      !rooms ||
      !session ||
      !currentItem ||
      !nextEpisode
    ) {
      return;
    }

    const match = findNextEpisodeRoom({
      rooms,
      serverId: currentItem.serverId,
      nextRatingKey: nextEpisode.ratingKey,
      currentRoom: session.room,
    });
    // Only ever adopt/replace, never clear: a transiently empty room list
    // near the episode's end must not un-learn the room mid-swap.
    if (match && match.id !== nextRoom?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting an async discovery result
      setNextRoom(match);
      // Presence and grace learned against a replaced room must not satisfy
      // the swap gating for the new one.
      setNextRoomParticipants({});
      setGraceElapsed(false);
    }
  }, [armed, nextRoom, swapped, rooms, session, currentItem, nextEpisode]);

  // Prefetch the next episode's full metadata (Media/Part/Stream) while the
  // protocol is armed, so the swap can hand the player a directly playable
  // item — the stream URL builds immediately instead of erroring until the
  // settings menu's metadata hydration kicks in.
  const nextMetadataQuery = api.plex.getItemMetadata.useQuery(
    {
      serverId: currentItem?.serverId ?? "",
      ratingKey: nextEpisode?.ratingKey ?? "",
    },
    {
      enabled: armed && Boolean(currentItem?.serverId && nextEpisode),
      staleTime: 5 * 60 * 1000,
    },
  );
  const nextEpisodeMetadata =
    nextMetadataQuery.data?.ratingKey === nextEpisode?.ratingKey
      ? nextMetadataQuery.data
      : undefined;

  const createRoomMutation = api.plex.createWatchTogetherRoom.useMutation({
    onSuccess: () => {
      // Don't latch onto the created room directly — refresh the room list so
      // the discovery path adopts it. Discovery is the single source of truth,
      // so even the creator converges on the deterministic winner if a
      // duplicate exists.
      void utils.plex.getWatchTogetherRooms.invalidate();
    },
    onError: () => {
      // Re-arm creation so a transient failure retries (after the same
      // rank-staggered delay) instead of silently disabling auto-advance for
      // the rest of the episode — fatal when this is the only Multiplex
      // client, since no failover would cover it. The token bump makes the
      // creation effect actually re-run; resetting the ref alone wouldn't.
      hasAttemptedCreateRef.current = false;
      setCreateRetryToken((token) => token + 1);
    },
  });
  const createNextRoom = createRoomMutation.mutate;

  // Deterministic leader election with staggered failover: rank r creates the
  // room after r * stagger unless someone else's room shows up first. Every
  // client computes the same ranking from the shared participant state, so
  // exactly one client normally creates — and if it fails or is gone, the
  // next in line takes over.
  const rank = useMemo(
    () => (localUser ? getAutoAdvanceRank(participants, localUser) : -1),
    [participants, localUser],
  );

  useEffect(() => {
    if (
      !armed ||
      nextRoom ||
      swapped ||
      rank < 0 ||
      !session ||
      !currentItem ||
      !nextEpisode ||
      hasAttemptedCreateRef.current
    ) {
      return;
    }

    const roomUsers = session.room.users;
    const localUserId = session.localUser.id;
    const timer = setTimeout(
      () => {
        if (hasAttemptedCreateRef.current) {
          return;
        }
        hasAttemptedCreateRef.current = true;
        createNextRoom({
          serverId: currentItem.serverId,
          ratingKey: nextEpisode.ratingKey,
          key: nextEpisode.key,
          title: nextEpisode.title || `Episode ${nextEpisode.index}`,
          users: roomUsers
            .map((user) => user.id)
            .filter((id) => id !== localUserId),
        });
      },
      CREATE_BASE_DELAY_MS + rank * CREATE_STAGGER_MS,
    );

    return () => clearTimeout(timer);
  }, [
    armed,
    nextRoom,
    swapped,
    rank,
    session,
    currentItem,
    nextEpisode,
    createNextRoom,
    createRetryToken,
  ]);

  // Once the episode has ended, join the next room's Syncplay as a silent
  // observer. This is the invisible "joined the new lobby": it marks us
  // present for the other Multiplex clients' everyone-joined checks (and for
  // official clients looking at the new room's lobby). Joining only at the
  // end keeps an official client's lobby from auto-starting the next episode
  // while this party is still finishing the current one.
  const shouldObserveNextRoom = armed && atEnd && !swapped;

  useEffect(() => {
    if (!shouldObserveNextRoom || !nextRoom || !localUser) {
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let client: SyncplayClient | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }

      const nextClient = new SyncplayClient({
        room: {
          id: nextRoom.id,
          syncplayHost: nextRoom.syncplayHost,
          syncplayPort: nextRoom.syncplayPort,
          sourceUri: nextRoom.sourceUri,
        },
        user: localUser,
        observer: true,
        onParticipant: (participant) =>
          setNextRoomParticipants((previous) =>
            mergeParticipantState(previous, participant),
          ),
        onClose: () => {
          if (disposed || client !== nextClient) {
            return;
          }
          client = null;
          reconnectTimer = setTimeout(connect, OBSERVER_RECONNECT_DELAY_MS);
        },
      });

      nextClient.connect();
      // Present in the next room, not yet watching; the player's driving
      // connection takes over after the swap.
      nextClient.setReady(false);
      client = nextClient;
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      client?.disconnect();
      client = null;
    };
  }, [shouldObserveNextRoom, nextRoom, localUser]);

  // Grace period after the end: if the rest of the party hasn't appeared in
  // the next room by then, swap anyway rather than stranding this viewer on
  // the end screen. Measured from when the next room is actually known (not
  // just from the episode ending), so a room discovered late still gets its
  // full gathering window instead of swapping the instant it appears.
  useEffect(() => {
    if (!armed || !atEnd || swapped || !nextRoom) {
      return;
    }
    const timer = setTimeout(
      () => setGraceElapsed(true),
      EVERYONE_JOINED_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [armed, atEnd, swapped, nextRoom]);

  const deleteRoomMutation = api.plex.deleteWatchTogetherRoom.useMutation({
    onSettled: () => {
      void utils.plex.getWatchTogetherRooms.invalidate();
    },
  });
  const deletePreviousRoom = deleteRoomMutation.mutate;

  // The swap: once the episode has ended and the party has gathered in the
  // next room (or the grace period ran out), rebind the session and player to
  // the next episode in place — the modal never closes, exactly like solo
  // autoplay, and the driving Syncplay connection follows the session change.
  useEffect(() => {
    if (
      !armed ||
      swapped ||
      !atEnd ||
      !nextRoom ||
      !session ||
      !currentItem ||
      !nextEpisode
    ) {
      return;
    }

    const everyoneJoined = haveMultiplexParticipantsJoined(
      participants,
      nextRoomParticipants,
      session.localUser,
    );
    if (!everyoneJoined && !graceElapsed) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch for the swap side effect
    setSwapped(true);

    const previousRoomId = session.room.id;
    // Same item shape solo autoplay builds: keep the shared server/library
    // fields, drop the previous episode's stale Media/stream metadata, and —
    // when the prefetch landed — substitute the next episode's full metadata
    // so playback starts without waiting for hydration.
    const nextItem: MediaPlayerItem = {
      ...currentItem,
      Media: undefined,
      ...nextEpisodeMetadata,
      serverId: currentItem.serverId,
      serverUrl: currentItem.serverUrl,
      authToken: currentItem.authToken,
      ratingKey: nextEpisode.ratingKey,
      key: nextEpisode.key,
      title: nextEpisode.title,
      type: "episode",
      index: nextEpisode.index,
      parentIndex: nextEpisode.parentIndex,
      thumb: nextEpisode.thumb,
      art: nextEpisode.art,
      duration: nextEpisode.duration,
      grandparentTitle: nextEpisode.grandparentTitle,
      parentTitle: nextEpisode.parentTitle,
      viewOffset: 0,
    };

    // Session first, then the player, in the same batch: the Syncplay session
    // hook tears down bindings whose session doesn't match the playing item,
    // so the two must change together. Everyone starts the next episode from
    // the beginning (resume: false), staying in sync.
    setSession({ room: nextRoom, localUser: session.localUser });
    openPlayer(nextItem, { resume: false });

    // The previous room served its purpose; drop it from this user's room
    // list (per-user removal — official clients still finishing keep theirs).
    deletePreviousRoom({ roomId: previousRoomId });

    // The page under the modal is usually the previous room's lobby, which is
    // now gone. Silently move it to the next room's lobby (the modal stays on
    // top, so nothing flashes), so closing the player later doesn't strand the
    // viewer on a dead room page. (One-shot imperative check — window.location
    // rather than usePathname(), which the statically prerendered root layout
    // can't read outside a Suspense boundary.)
    if (window.location.pathname === getWatchTogetherRoomHref(previousRoomId)) {
      router.replace(getWatchTogetherRoomHref(nextRoom.id));
    }
  }, [
    armed,
    swapped,
    atEnd,
    nextRoom,
    session,
    currentItem,
    nextEpisode,
    participants,
    nextRoomParticipants,
    graceElapsed,
    nextEpisodeMetadata,
    setSession,
    openPlayer,
    deletePreviousRoom,
    router,
  ]);

  return {
    /** Show the "Up Next" countdown (last few seconds, until the swap). */
    isCountingDown: armed && !swapped && timeRemaining <= COUNTDOWN_SECONDS,
    countdownSeconds: Math.max(
      0,
      Math.ceil(Math.min(timeRemaining, COUNTDOWN_SECONDS)),
    ),
    nextEpisode: armed ? nextEpisode : null,
  };
}

import type {
  ParticipantMap,
  SyncplayParticipantState,
  SyncplayPlayerAdapter,
  SyncplaySessionControllerOptions,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { Effect, type Scope } from "effect";

import type { WatchTogetherSessionToasts } from "~/components/watch-together/watch-together-session-toasts";
import { playbackUsesTranscode } from "~/components/media-player/utils/plex-playback-plan";

import type { PlayerPortContract } from "./player-port";

export type SessionControllerLike = {
  connect: () => void;
  disconnect: () => void;
  setReady: (isReady: boolean | null) => void;
  handleLocalPlaybackChange: (isPaused: boolean) => void;
  handleLocalSeeked: (seconds: number) => void;
};

export type MakeSessionController = (
  options: SyncplaySessionControllerOptions,
) => SessionControllerLike;

/** Device ids of peers we already consider part of this party. */
export const cohortDeviceIds = (
  participants: ParticipantMap,
  localUser: SyncplayUser,
): ReadonlySet<string> =>
  new Set(
    Object.entries(participants).flatMap(([id, participant]) =>
      id !== localUser.deviceIdentifier && participant.isPresent !== false
        ? [id]
        : [],
    ),
  );

export const playerAdapterFromPort = (
  player: PlayerPortContract,
): SyncplayPlayerAdapter => ({
  getState: () => {
    const snap = player.snapshot();
    const currentItem = player.currentItem();
    return {
      isPlaying: snap.isPlaying,
      currentTime: snap.currentTimeSeconds,
      duration: snap.durationSeconds,
      canPlay: snap.canPlay,
      isLoading: snap.isLoading,
      seekRequiresReload:
        currentItem !== null && playbackUsesTranscode(currentItem),
      error: snap.error,
    };
  },
  // Pass results through untouched: the controller relies on play() reporting
  // autoplay failures and on seek() returning "none" to retry a remote seek
  // that arrived before the <video> was ready.
  play: () => player.play(),
  pause: () => {
    player.pause();
  },
  seek: (positionSeconds) => player.seek(positionSeconds),
  setPlaybackRate: (rate) => player.setPlaybackRate(rate),
});

export type ConnectionParams = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
  readonly isCurrent: () => boolean;
  readonly onParticipant: (participant: SyncplayParticipantState) => void;
  readonly onFatalError: () => void;
  readonly onController: (controller: SessionControllerLike) => void;
  /** Toast / readiness notifier owned by the session lifecycle. */
  readonly notifications: WatchTogetherSessionToasts;
  readonly canInitiateStartupPlayback: boolean;
};

/**
 * Scoped Syncplay driver: wires notifications + readiness observation as an
 * `Effect.acquireRelease` resource. Readiness comes from
 * {@link PlayerPortContract.subscribe} so the service does not import the
 * media-player store directly.
 */
export const runConnection = (
  params: ConnectionParams,
  player: PlayerPortContract,
  makeController: MakeSessionController,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const { notifications } = params;

      const controller = makeController({
        room: params.room,
        user: params.localUser,
        player: playerAdapterFromPort(player),
        onParticipant: (participant) => {
          if (!params.isCurrent()) return;
          params.onParticipant(participant);
          notifications.handleParticipant(participant);
        },
        onRemoteAction: notifications.handleRemoteAction,
        onFatalError: () => {
          if (!params.isCurrent()) return;
          params.onFatalError();
        },
        canInitiateStartupPlayback: params.canInitiateStartupPlayback,
      });

      if (params.isCurrent()) {
        params.onController(controller);
      }
      controller.connect();

      if (player.snapshot().canPlay) {
        notifications.noteLocalStarted();
      }
      let previousCanPlay = player.snapshot().canPlay;
      const unsubscribeReady = player.subscribe((snap) => {
        if (snap.canPlay === previousCanPlay) return;
        previousCanPlay = snap.canPlay;
        controller.setReady(snap.canPlay);
        if (snap.canPlay) {
          notifications.noteLocalStarted();
        }
      });

      return { controller, notifications, unsubscribeReady };
    }),
    ({ controller, notifications, unsubscribeReady }) =>
      Effect.sync(() => {
        unsubscribeReady();
        controller.disconnect();
        notifications.dispose();
      }),
  ).pipe(Effect.andThen(Effect.never));

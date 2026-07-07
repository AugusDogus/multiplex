import {
  SyncplaySessionController,
  type SyncplayParticipantState,
  type SyncplayPlayerAdapter,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import { createWatchTogetherSessionToasts } from "~/components/watch-together/watch-together-session-toasts";
import { useMediaPlayerStore } from "~/stores/media-player-store";

export interface WatchTogetherSessionBindingOptions {
  room: WatchTogetherRoom;
  localUser: SyncplayUser;
  /** Bridge to the mounted <video> element (play/pause/seek + state). */
  player: SyncplayPlayerAdapter;
  /** Participant updates for the watch-together store. */
  onParticipant: (participant: SyncplayParticipantState) => void;
  onFatalError: () => void;
}

export interface WatchTogetherSessionBinding {
  /** A deliberate local play/pause (from the video element's events). */
  handleLocalPlaybackChange: (isPaused: boolean) => void;
  /** A deliberate local seek (from the video element / stream-offset reload). */
  handleLocalSeeked: (time: number) => void;
  dispose: () => void;
}

/**
 * The event wiring for one Watch Together playback session, independent of
 * React: Syncplay frames drive the player and the toast notifier through
 * {@link SyncplaySessionController}'s callbacks, the video element's events
 * arrive through the returned handlers, and player readiness is observed as
 * media-player store transitions. React's only job is lifecycle — create the
 * binding when a session becomes active for the playing item, dispose it when
 * it ends.
 */
export function bindWatchTogetherSession(
  options: WatchTogetherSessionBindingOptions,
): WatchTogetherSessionBinding {
  const toasts = createWatchTogetherSessionToasts({
    room: options.room,
    localUser: options.localUser,
  });

  const controller = new SyncplaySessionController({
    room: options.room,
    user: options.localUser,
    player: options.player,
    onParticipant: (participant) => {
      options.onParticipant(participant);
      toasts.handleParticipant(participant);
    },
    onRemoteAction: toasts.handleRemoteAction,
    onFatalError: options.onFatalError,
  });

  controller.connect();

  // Readiness and local fast-forward both live in the media-player store as the
  // <video> element's events land there, so observe them as store transitions.
  // (The controller samples the initial ready value itself on connect.)
  if (useMediaPlayerStore.getState().canPlay) {
    toasts.noteLocalStarted();
  }
  controller.setLocalFastForward(
    useMediaPlayerStore.getState().isLocalFastForward,
  );
  const unsubscribeStore = useMediaPlayerStore.subscribe(
    (state, previousState) => {
      if (state.canPlay !== previousState.canPlay) {
        controller.setReady(state.canPlay);
        if (state.canPlay) {
          toasts.noteLocalStarted();
        }
      }
      if (state.isLocalFastForward !== previousState.isLocalFastForward) {
        controller.setLocalFastForward(state.isLocalFastForward);
      }
    },
  );

  return {
    handleLocalPlaybackChange: (isPaused) =>
      controller.handleLocalPlaybackChange(isPaused),
    handleLocalSeeked: (time) => controller.handleLocalSeeked(time),
    dispose: () => {
      unsubscribeStore();
      controller.disconnect();
      toasts.dispose();
    },
  };
}

import type {
  NativePlayerEvent,
  NativePlayerLoadInput,
  NativePlayerPlaybackIdentity,
  NativePlayerSeekResult,
  NativePlayerStatusEncoded,
  NativeVideoSurface,
} from "@multiplex/desktop-contracts";
import type { LibmpvEvent, LibmpvPlayer } from "@multiplex/libmpv";
import { loadLibmpvBinding } from "@multiplex/libmpv";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export class NativePlayerOperationError extends Schema.TaggedError<NativePlayerOperationError>()(
  "NativePlayerOperationError",
  {
    operation: Schema.Literals(["load", "play", "pause", "volume", "rate", "present", "stop"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `The embedded libmpv player failed to ${this.operation}.`;
  }
}

type NativePlayerListener = (event: NativePlayerEvent) => void;

export class NativePlayer extends Context.Service<
  NativePlayer,
  {
    readonly getStatus: Effect.Effect<NativePlayerStatusEncoded>;
    readonly load: (
      input: NativePlayerLoadInput,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly play: (
      identity: NativePlayerPlaybackIdentity,
    ) => Effect.Effect<boolean, NativePlayerOperationError>;
    readonly pause: (
      identity: NativePlayerPlaybackIdentity,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly seek: (
      identity: NativePlayerPlaybackIdentity,
      seconds: number,
    ) => NativePlayerSeekResult;
    readonly setVolume: (
      identity: NativePlayerPlaybackIdentity,
      volume: number,
      muted: boolean,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly setRate: (
      identity: NativePlayerPlaybackIdentity,
      playbackRate: number,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly present: (
      surface: NativeVideoSurface,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly reconcilePresentation: Effect.Effect<void, NativePlayerOperationError>;
    readonly suspendPresentation: Effect.Effect<void, NativePlayerOperationError>;
    readonly shutdown: Effect.Effect<void>;
    readonly stop: (
      identity: NativePlayerPlaybackIdentity,
    ) => Effect.Effect<void, NativePlayerOperationError>;
    readonly subscribe: (listener: NativePlayerListener) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@multiplex/desktop/player/NativePlayer") {}

const identityMatches = (
  left: NativePlayerPlaybackIdentity | null,
  right: NativePlayerPlaybackIdentity,
): boolean =>
  left?.streamSessionId === right.streamSessionId &&
  left.serverId === right.serverId &&
  left.ratingKey === right.ratingKey &&
  left.sourceGeneration === right.sourceGeneration;

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const createPlayer = (
  bindingPath: string,
  onEvent: (event: LibmpvEvent) => void,
):
  | { readonly _tag: "Ready"; readonly player: LibmpvPlayer }
  | { readonly _tag: "Unavailable"; readonly reason: string } => {
  try {
    return {
      _tag: "Ready",
      player: loadLibmpvBinding(bindingPath).createPlayer(onEvent),
    };
  } catch (cause) {
    return { _tag: "Unavailable", reason: describeCause(cause) };
  }
};

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const listeners = new Set<NativePlayerListener>();
  let activeIdentity: NativePlayerPlaybackIdentity | null = null;
  let status: NativePlayerStatusEncoded = { _tag: "Idle" };
  let currentPresentation: NativeVideoSurface = { _tag: "Hidden" };

  const emit = (event: NativePlayerEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const native = createPlayer(environment.libmpvAddonPath, (event) => {
    const identity = activeIdentity;
    if (identity === null || event.sourceGeneration !== identity.sourceGeneration) {
      return;
    }

    switch (event._tag) {
      case "FileLoaded":
        status = { _tag: "Ready", identity };
        emit({
          _tag: "Ready",
          identity,
          durationSeconds: event.durationSeconds,
        });
        break;
      case "PlaybackChanged":
        emit({ _tag: "PlaybackChanged", identity, isPlaying: event.isPlaying });
        break;
      case "TimeChanged":
        emit({
          _tag: "TimeChanged",
          identity,
          currentTimeSeconds: event.currentTimeSeconds,
          bufferedTimeSeconds: event.bufferedTimeSeconds,
        });
        break;
      case "BufferingChanged":
        emit({
          _tag: "BufferingChanged",
          identity,
          isBuffering: event.isBuffering,
        });
        break;
      case "Seeked":
        emit({
          _tag: "Seeked",
          identity,
          currentTimeSeconds: event.currentTimeSeconds,
        });
        break;
      case "Ended":
        emit({ _tag: "Ended", identity });
        break;
      case "Error":
        emit({ _tag: "Error", identity, message: event.message });
        break;
    }
  });

  if (native._tag === "Unavailable") {
    status = { _tag: "Unavailable", reason: native.reason };
  }
  const player = native._tag === "Ready" ? native.player : null;

  const operation = (
    name: NativePlayerOperationError["operation"],
    run: (player: LibmpvPlayer) => void,
  ): Effect.Effect<void, NativePlayerOperationError> =>
    player === null
      ? Effect.fail(
          new NativePlayerOperationError({
            operation: name,
            cause: status._tag === "Unavailable" ? status.reason : "libmpv is unavailable.",
          }),
        )
      : Effect.try({
          try: () => run(player),
          catch: (cause) => new NativePlayerOperationError({ operation: name, cause }),
        });

  const present = (surface: NativeVideoSurface): Effect.Effect<void, NativePlayerOperationError> =>
    surface._tag === "Hidden"
      ? operation("present", (instance) => instance.present(surface))
      : electronWindow.main.pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new NativePlayerOperationError({
                    operation: "present",
                    cause: "The main Electron window is not available.",
                  }),
                ),
              onSome: (window) =>
                operation("present", (instance) =>
                  instance.present({
                    ...surface,
                    ownerHandle: window.getNativeWindowHandle(),
                  }),
                ),
            }),
          ),
        );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      player?.dispose();
    }),
  );

  return NativePlayer.of({
    getStatus: Effect.sync(() => status),
    load: (input) =>
      operation("load", (instance) => {
        activeIdentity = input.identity;
        status = { _tag: "Loading", identity: input.identity };
        emit({ _tag: "Loading", identity: input.identity });
        instance.load({
          sourceGeneration: input.identity.sourceGeneration,
          url: input.url,
          title: input.title,
          startSeconds: input.startSeconds,
          volume: input.volume,
          muted: input.muted,
          playbackRate: input.playbackRate,
        });
      }),
    play: (identity) =>
      identityMatches(activeIdentity, identity)
        ? operation("play", (instance) => instance.play()).pipe(Effect.as(true))
        : Effect.succeed(false),
    pause: (identity) =>
      identityMatches(activeIdentity, identity)
        ? operation("pause", (instance) => instance.pause())
        : Effect.void,
    seek: (identity, seconds) => {
      if (!identityMatches(activeIdentity, identity) || player === null) {
        return "none";
      }
      try {
        player.seek(seconds);
        return "direct";
      } catch {
        return "none";
      }
    },
    setVolume: (identity, volume, muted) =>
      identityMatches(activeIdentity, identity)
        ? operation("volume", (instance) => instance.setVolume(volume, muted))
        : Effect.void,
    setRate: (identity, playbackRate) =>
      identityMatches(activeIdentity, identity)
        ? operation("rate", (instance) => instance.setRate(playbackRate))
        : Effect.void,
    present: (surface) =>
      Effect.sync(() => {
        currentPresentation = surface;
      }).pipe(Effect.andThen(present(surface))),
    reconcilePresentation: Effect.suspend(() => present(currentPresentation)),
    suspendPresentation: present({ _tag: "Hidden" }),
    shutdown: Effect.sync(() => player?.dispose()),
    stop: (identity) =>
      identityMatches(activeIdentity, identity)
        ? operation("stop", (instance) => instance.stop()).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                activeIdentity = null;
                status = { _tag: "Idle" };
              }),
            ),
          )
        : Effect.void,
    subscribe: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => listeners.add(listener)),
        () => Effect.sync(() => listeners.delete(listener)),
      ).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(NativePlayer, make);

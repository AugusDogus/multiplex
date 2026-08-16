"use client";

import type { SessionState } from "@multiplex/plex-query";
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { PlayerPort, type PlayerActions } from "./player-port";
import { sessionRuntime } from "./runtime";
import {
  WatchTogetherSession,
  type EnterLobbyInput,
  type ExitLobbyOptions,
  type LeaveOptions,
  type LobbyContext,
  type RotationContext,
  type StartPlaybackInput,
  type SwapToInput,
  type WatchTogetherSessionContract,
} from "./session-service";

/**
 * App-lifetime Effect runtime for Watch Together session orchestration.
 *
 * This module is the designated boundary for running session effects from
 * synchronous React and event-handler APIs.
 *
 * Bridge shipped: `Atom.subscriptionRef` over the service's
 * `SubscriptionRef<SessionState>` (not the stream-atom /
 * `useSyncExternalStore` fallbacks). Values reach React via
 * `useAtomValue(sessionStateAtom)`.
 *
 * Runtime composition (PlayerService + PlayerPort + session + API) lives in
 * {@link ./runtime} so {@link ./player-atoms} shares the same graph without a
 * circular import.
 */
export { sessionRuntime };

const session: WatchTogetherSessionContract = sessionRuntime.runSync(
  Effect.gen(function* () {
    return yield* WatchTogetherSession;
  }),
);

/**
 * Synchronous SessionState for React. Backed by `Atom.subscriptionRef` so
 * updates from the service's SubscriptionRef propagate without polling.
 */
export const sessionStateAtom: Atom.Atom<SessionState> = Atom.subscriptionRef(
  session.state,
).pipe(Atom.keepAlive);

export function useSessionState(): SessionState {
  return useAtomValue(sessionStateAtom);
}

/**
 * Sync-safe commands: no Fiber.interrupt of scoped resources. Safe under
 * `runSync` because they only touch refs / SubscriptionRef / live controller.
 */
const runSessionSync = <A>(
  f: (s: WatchTogetherSessionContract) => Effect.Effect<A>,
): A => sessionRuntime.runSync(f(session));

/**
 * Commands that may interrupt scoped resources run as observable promises.
 * ManagedRuntime owns their fibers and service-level serialization determines
 * ordering, including when callers queue cleanup before prior work completes.
 */
type SessionLifecycleRuntime = {
  readonly runPromise: <A>(effect: Effect.Effect<A>) => Promise<A>;
};

export type SessionCommand<A> = {
  readonly completion: Promise<A>;
};

const runLifecycleCommand = <A>(
  runtime: SessionLifecycleRuntime,
  effect: Effect.Effect<A>,
): SessionCommand<A> => ({ completion: runtime.runPromise(effect) });

export const makeSessionLifecycleCommands = (
  runtime: SessionLifecycleRuntime,
  service: WatchTogetherSessionContract,
) => ({
  enterLobby: (input: EnterLobbyInput): SessionCommand<void> =>
    runLifecycleCommand(runtime, service.enterLobby(input)),
  exitLobby: (options?: ExitLobbyOptions): SessionCommand<void> =>
    runLifecycleCommand(runtime, service.exitLobby(options)),
  startPlayback: (input: StartPlaybackInput): SessionCommand<boolean> =>
    runLifecycleCommand(runtime, service.startPlayback(input)),
  swapTo: (input: SwapToInput): SessionCommand<void> =>
    runLifecycleCommand(runtime, service.swapTo(input)),
  leave: (options: LeaveOptions): SessionCommand<void> =>
    runLifecycleCommand(runtime, service.leave(options)),
});

const lifecycleCommands = makeSessionLifecycleCommands(sessionRuntime, session);

/**
 * Plain-function command facade for non-React callers (lobby, auto-advance
 * hook, modal event handlers). Each call runs on {@link sessionRuntime}.
 *
 * Lifecycle commands expose completion while synchronous local commands stay
 * on `runSync`.
 */
export const sessionCommands = {
  ...lifecycleCommands,
  updateLobbyRoom: (room: EnterLobbyInput["room"]): void => {
    runSessionSync((s) => s.updateLobbyRoom(room));
  },
  setLobbyContext: (ctx: LobbyContext): void => {
    runSessionSync((s) => s.setLobbyContext(ctx));
  },
  setRotationContext: (ctx: RotationContext): void => {
    sessionRuntime.runFork(session.setRotationContext(ctx));
  },
  handleLocalPlaybackChange: (isPaused: boolean): void => {
    runSessionSync((s) => s.handleLocalPlaybackChange(isPaused));
  },
  handleLocalSeeked: (seconds: number): void => {
    runSessionSync((s) => s.handleLocalSeeked(seconds));
  },
  getSuppressedRoomId: (): string | null => session.getSuppressedRoomId(),
  snapshot: (): SessionState => session.snapshot(),
  /**
   * Wire the mounted video element's play/pause/seek into PlayerPort.
   * Returns an unregister that clears only if this registration is still current.
   */
  registerPlayerActions: (actions: PlayerActions): (() => void) =>
    sessionRuntime.runSync(
      Effect.gen(function* () {
        const port = yield* PlayerPort;
        return port.registerActions(actions);
      }),
    ),
};

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
  type LeaveOptions,
  type LobbyContext,
  type RotationContext,
  type StartPlaybackInput,
  type SwapToInput,
  type WatchTogetherSessionShape,
} from "./session-service";

/**
 * App-lifetime Effect runtime for Watch Together session orchestration.
 *
 * Designated escape-hatch boundary: `runSync` / `runPromise` are allowed here
 * (oxlint `no-effect-escape-hatch` exempts `apps/web/src/lib/effect/**`).
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

const session: WatchTogetherSessionShape = sessionRuntime.runSync(
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
  f: (s: WatchTogetherSessionShape) => Effect.Effect<A>,
): A => sessionRuntime.runSync(f(session));

/**
 * Commands that may `Fiber.interrupt` scoped connection/lobby/rotation fibers.
 * Interrupt awaits finalizers; an async finalizer makes the effect async and
 * `runSync` throws `AsyncFiberError`. Always fork — with sync finalizers
 * (our production case: `controller.disconnect` is sync) the interrupt +
 * subsequent state writes still complete before `runFork` returns, so
 * immediate `snapshot()` / atom reads see the transition. Call sites that
 * care about post-command state should prefer `useSessionState()` (atom) over
 * racing a follow-up `snapshot()` after a fire-and-forget fork.
 */
const runSessionFork = (
  f: (s: WatchTogetherSessionShape) => Effect.Effect<void>,
): void => {
  sessionRuntime.runFork(f(session));
};

/**
 * Plain-function command facade for non-React callers (lobby, auto-advance
 * hook, modal event handlers). Each call runs on {@link sessionRuntime}.
 *
 * Interrupting commands (`enterLobby` when switching rooms, `exitLobby`,
 * `startPlayback`, `swapTo`, `leave`) use `runFork` so they never depend on
 * finalizer synchronicity. Non-interrupting commands stay on `runSync`.
 */
export const sessionCommands = {
  enterLobby: (input: EnterLobbyInput): void => {
    runSessionFork((s) => s.enterLobby(input));
  },
  updateLobbyRoom: (room: EnterLobbyInput["room"]): void => {
    runSessionSync((s) => s.updateLobbyRoom(room));
  },
  exitLobby: (): void => {
    runSessionFork((s) => s.exitLobby());
  },
  setLobbyContext: (ctx: LobbyContext): void => {
    runSessionSync((s) => s.setLobbyContext(ctx));
  },
  startPlayback: (input: StartPlaybackInput): void => {
    runSessionFork((s) => s.startPlayback(input));
  },
  swapTo: (input: SwapToInput): void => {
    runSessionFork((s) => s.swapTo(input));
  },
  leave: (options: LeaveOptions): void => {
    runSessionFork((s) => s.leave(options));
  },
  setRotationContext: (ctx: RotationContext): void => {
    runSessionFork((s) => s.setRotationContext(ctx));
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

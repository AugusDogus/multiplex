"use client";

import type { SessionState } from "@multiplex/plex-query";
import { useAtomValue } from "@effect/atom-react";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { PlayerPort, type PlayerActions } from "./player-port";
import {
  WatchTogetherSession,
  type LeaveOptions,
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
 */
const sessionLayer = WatchTogetherSession.Default.pipe(
  Layer.provideMerge(PlayerPort.Default),
);

export const sessionRuntime = ManagedRuntime.make(sessionLayer);

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

const runSession = <A>(
  f: (s: WatchTogetherSessionShape) => Effect.Effect<A>,
): A => sessionRuntime.runSync(f(session));

/**
 * Plain-function command facade for non-React callers (lobby, auto-advance
 * hook, modal event handlers). Each call runs on {@link sessionRuntime}.
 */
export const sessionCommands = {
  startPlayback: (input: StartPlaybackInput): void => {
    runSession((s) => s.startPlayback(input));
  },
  swapTo: (input: SwapToInput): void => {
    runSession((s) => s.swapTo(input));
  },
  leave: (options: LeaveOptions): void => {
    runSession((s) => s.leave(options));
  },
  handleLocalPlaybackChange: (isPaused: boolean): void => {
    runSession((s) => s.handleLocalPlaybackChange(isPaused));
  },
  handleLocalSeeked: (seconds: number): void => {
    runSession((s) => s.handleLocalSeeked(seconds));
  },
  snapshot: (): SessionState => session.snapshot(),
  /** Wire the mounted video element's play/pause/seek into PlayerPort. */
  registerPlayerActions: (actions: PlayerActions): void => {
    sessionRuntime.runSync(
      Effect.gen(function* () {
        const port = yield* PlayerPort;
        port.registerActions(actions);
      }),
    );
  },
};

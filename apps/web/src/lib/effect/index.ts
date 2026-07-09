"use client";

export {
  makeWatchTogetherApi,
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiShape,
  type WatchTogetherTrpcClient,
} from "./watch-together-api";

export {
  makePlayerPort,
  PlayerPort,
  type PlayerActions,
  type PlayerPortShape,
  type PlayerSnapshot,
} from "./player-port";

export {
  makeWatchTogetherSession,
  WatchTogetherSession,
  type EnterLobbyInput,
  type LeaveOptions,
  type LobbyContext,
  type MakeObserverConnection,
  type MakeSessionController,
  type MakeWatchTogetherSessionOptions,
  type ObserverConnectionLike,
  type RotationContext,
  type SessionControllerLike,
  type StartPlaybackInput,
  type SwapToInput,
  type WatchTogetherSessionShape,
} from "./session-service";

export {
  sessionCommands,
  sessionRuntime,
  sessionStateAtom,
  useSessionState,
} from "./session-atoms";

export { EffectRegistryProvider } from "./registry-provider";

"use client";

export {
  makeWatchTogetherApi,
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiContract,
  type WatchTogetherTrpcClient,
} from "./watch-together-api";

export {
  makePlayerPort,
  PlayerPort,
  type PlayerActions,
  type PlayerPortContract,
  type PlayerSnapshot,
} from "./player-port";

export {
  createPlayerService,
  initialPlayerState,
  makePlayerService,
  PlayerService,
  type PlayerPlaybackUpdate,
  type PlayerServiceContract,
  type PlayerState,
} from "./player-service";

export { playerCommands, usePlayerStateSelector } from "./player-atoms";

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
  type WatchTogetherSessionContract,
} from "./session-service";

export {
  sessionCommands,
  sessionRuntime,
  sessionStateAtom,
  useSessionState,
} from "./session-atoms";

export { appEffectLayer } from "./runtime";

export { EffectRegistryProvider } from "./registry-provider";

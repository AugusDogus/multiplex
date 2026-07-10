"use client";

export {
  makeWatchTogetherApi,
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiShape,
} from "./watch-together-api";

export { PlexApiClient, makePlexHttpApiClient } from "./plex-api-client";
export {
  asItemDetails,
  asItemMetadata,
  asPlayQueue,
  asWatchTogetherRoom,
  asWatchTogetherRooms,
  type ItemDetails,
} from "./plex-boundary";
export {
  ReactivityKey,
  watchTogetherRoomWriteKeys,
  watchTogetherRoomWriteKeysFor,
} from "./reactivity-keys";
export {
  createPlayQueue,
  createWatchTogetherRoom,
  deleteWatchTogetherRoom,
  inviteWatchTogetherUsers,
  itemDetailsAtom,
  itemMetadataAtom,
  playQueueAtom,
  removeWatchTogetherRoomOptimistic,
  sendTimeline,
  userInfoAtom,
  watchTogetherInviteesAtom,
  watchTogetherRoomAtom,
  watchTogetherRoomsAtom,
  watchTogetherRoomsOptimisticAtom,
} from "./plex-atoms";

export {
  makePlayerPort,
  PlayerPort,
  type PlayerActions,
  type PlayerPortShape,
  type PlayerSnapshot,
} from "./player-port";

export {
  createPlayerService,
  getBufferedPercent,
  getFormattedCurrentTime,
  getFormattedDuration,
  getIsReady,
  getPlayerStatus,
  getProgressPercent,
  initialPlayerState,
  makePlayerService,
  PlayerService,
  type PlayerPlaybackUpdate,
  type PlayerServiceShape,
  type PlayerState,
} from "./player-service";

export {
  playerCommands,
  playerStateAtom,
  usePlayerPlaybackState,
  usePlayerState,
  usePlayerStateSelector,
  type PlayerViewState,
} from "./player-atoms";

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

export { appEffectLayer } from "./runtime";

export { EffectRegistryProvider } from "./registry-provider";

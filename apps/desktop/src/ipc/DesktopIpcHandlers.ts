import {
  NativePlayerEvent,
  NativePlayerLoadInput,
  NativePlayerPlaybackIdentity,
  NativePlayerRateInput,
  NativePlayerSeekInput,
  NativePlayerStatus,
  NativePlayerVolumeInput,
  NativeVideoSurface,
} from "@multiplex/desktop-contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as NativePlayer from "../player/NativePlayer.ts";
import * as DesktopIpc from "./DesktopIpc.ts";
import {
  PLAYER_EVENT_CHANNEL,
  PLAYER_GET_STATUS_CHANNEL,
  PLAYER_LOAD_CHANNEL,
  PLAYER_PAUSE_CHANNEL,
  PLAYER_PLAY_CHANNEL,
  PLAYER_PRESENT_CHANNEL,
  PLAYER_SEEK_CHANNEL,
  PLAYER_SET_RATE_CHANNEL,
  PLAYER_SET_VOLUME_CHANNEL,
  PLAYER_STOP_CHANNEL,
} from "./channels.ts";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const desktopIpc = yield* DesktopIpc.DesktopIpc;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const player = yield* NativePlayer.NativePlayer;
  const expectedOrigin = environment.rendererOrigin.href;

  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_GET_STATUS_CHANNEL,
      payload: Schema.Void,
      result: NativePlayerStatus,
      handler: () => player.getStatus,
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_LOAD_CHANNEL,
      payload: NativePlayerLoadInput,
      result: Schema.Void,
      handler: player.load,
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_PLAY_CHANNEL,
      payload: NativePlayerPlaybackIdentity,
      result: Schema.Boolean,
      handler: player.play,
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_PAUSE_CHANNEL,
      payload: NativePlayerPlaybackIdentity,
      result: Schema.Void,
      handler: player.pause,
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handleSync(
    DesktopIpc.makeSyncIpcMethod({
      channel: PLAYER_SEEK_CHANNEL,
      payload: NativePlayerSeekInput,
      result: Schema.Literals(["direct", "none"]),
      fallback: "none",
      handler: ({ identity, seconds }) => Effect.sync(() => player.seek(identity, seconds)),
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_PRESENT_CHANNEL,
      payload: NativeVideoSurface,
      result: Schema.Void,
      handler: player.present,
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_SET_VOLUME_CHANNEL,
      payload: NativePlayerVolumeInput,
      result: Schema.Void,
      handler: ({ identity, volume, muted }) => player.setVolume(identity, volume, muted),
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_SET_RATE_CHANNEL,
      payload: NativePlayerRateInput,
      result: Schema.Void,
      handler: ({ identity, playbackRate }) => player.setRate(identity, playbackRate),
    }),
    expectedOrigin,
  );
  yield* desktopIpc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PLAYER_STOP_CHANNEL,
      payload: NativePlayerPlaybackIdentity,
      result: Schema.Void,
      handler: player.stop,
    }),
    expectedOrigin,
  );

  const encodeEvent = Schema.encodeUnknownEffect(NativePlayerEvent);
  yield* player.subscribe((event) => {
    Effect.runFork(
      encodeEvent(event).pipe(
        Effect.flatMap((encoded) => electronWindow.sendAll(PLAYER_EVENT_CHANNEL, encoded)),
      ),
    );
  });
});

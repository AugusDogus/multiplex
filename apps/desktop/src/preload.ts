import type { MultiplexDesktopBridge } from "@multiplex/desktop-contracts";
import { NativePlayerEvent } from "@multiplex/desktop-contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { contextBridge, ipcRenderer } from "electron";

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
} from "./ipc/channels.ts";

const decodePlayerEvent = Schema.decodeUnknownOption(NativePlayerEvent);

const bridge = {
  player: {
    getStatus: () => ipcRenderer.invoke(PLAYER_GET_STATUS_CHANNEL),
    load: (input) => ipcRenderer.invoke(PLAYER_LOAD_CHANNEL, input),
    play: (identity) => ipcRenderer.invoke(PLAYER_PLAY_CHANNEL, identity),
    pause: (identity) => ipcRenderer.invoke(PLAYER_PAUSE_CHANNEL, identity),
    seek: (input) => ipcRenderer.sendSync(PLAYER_SEEK_CHANNEL, input),
    present: (surface) => ipcRenderer.invoke(PLAYER_PRESENT_CHANNEL, surface),
    setVolume: (input) => ipcRenderer.invoke(PLAYER_SET_VOLUME_CHANNEL, input),
    setRate: (input) => ipcRenderer.invoke(PLAYER_SET_RATE_CHANNEL, input),
    stop: (identity) => ipcRenderer.invoke(PLAYER_STOP_CHANNEL, identity),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        const decoded = decodePlayerEvent(raw);
        if (Option.isSome(decoded)) listener(decoded.value);
      };
      ipcRenderer.on(PLAYER_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(PLAYER_EVENT_CHANNEL, handler);
    },
  },
} satisfies MultiplexDesktopBridge;

contextBridge.exposeInMainWorld("multiplexDesktop", bridge);

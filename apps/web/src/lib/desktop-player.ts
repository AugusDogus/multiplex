"use client";

import type {
  MultiplexDesktopBridge,
  NativePlayerPlaybackIdentityEncoded,
} from "@multiplex/desktop-contracts";
import { useSyncExternalStore } from "react";
import { playerCommands } from "~/lib/effect/player-atoms";

declare global {
  interface Window {
    readonly multiplexDesktop?: MultiplexDesktopBridge;
  }
}

const subscribe = (): (() => void) => () => undefined;

export const getDesktopPlayer = () =>
  typeof window === "undefined" ? undefined : window.multiplexDesktop?.player;

export const useNativePlayerAvailable = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => getDesktopPlayer() !== undefined,
    () => false,
  );

export const getNativePlaybackIdentity = ():
  | NativePlayerPlaybackIdentityEncoded
  | undefined => {
  const identity = playerCommands.playbackIdentity();
  if (!identity) return undefined;
  return {
    ...identity,
    sourceGeneration: playerCommands.snapshot().sourceGeneration,
  };
};

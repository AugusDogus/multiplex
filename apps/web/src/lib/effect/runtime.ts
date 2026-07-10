"use client";

import { Layer, ManagedRuntime } from "effect";

import { PlayerPort } from "./player-port";
import { PlayerService } from "./player-service";
import { WatchTogetherSession } from "./session-service";
import { WatchTogetherApi } from "./watch-together-api";

/**
 * Shared ManagedRuntime for Watch Together + PlayerService.
 *
 * PlayerPort is layered over PlayerService so session orchestration and the
 * React player UI observe the same playback SubscriptionRef.
 */
const playerStack = PlayerPort.Default.pipe(
  Layer.provideMerge(PlayerService.Default),
);

export const appEffectLayer = WatchTogetherSession.Default.pipe(
  Layer.provideMerge(playerStack),
  Layer.provideMerge(WatchTogetherApi.Default),
);

export const sessionRuntime = ManagedRuntime.make(appEffectLayer);

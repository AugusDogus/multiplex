for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ipcMain } from "electron";

import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopShutdown from "./app/DesktopShutdown.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as NativePlayer from "./player/NativePlayer.ts";
import * as DesktopWebServer from "./server/DesktopWebServer.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";

ElectronProtocol.registerRendererSchemes();

const environmentLayer = DesktopEnvironment.layer(__dirname);
const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronProtocol.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(ipcMain),
).pipe(Layer.provideMerge(environmentLayer));

const foundationLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopWebServer.layer,
).pipe(Layer.provideMerge(environmentLayer));

const windowLayer = DesktopWindow.layer.pipe(
  Layer.provideMerge(electronLayer),
  Layer.provideMerge(environmentLayer),
);

const playerLayer = NativePlayer.layer.pipe(
  Layer.provideMerge(electronLayer),
  Layer.provideMerge(environmentLayer),
);

const lifecycleLayer = DesktopLifecycle.layer.pipe(
  Layer.provideMerge(windowLayer),
  Layer.provideMerge(playerLayer),
  Layer.provideMerge(foundationLayer),
  Layer.provideMerge(electronLayer),
  Layer.provideMerge(environmentLayer),
);

const desktopRuntimeLayer = Layer.mergeAll(
  environmentLayer,
  electronLayer,
  foundationLayer,
  windowLayer,
  playerLayer,
  lifecycleLayer,
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);

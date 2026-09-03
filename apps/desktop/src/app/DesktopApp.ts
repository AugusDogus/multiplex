import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers.ts";
import * as NativePlayer from "../player/NativePlayer.ts";
import * as DesktopWebServer from "../server/DesktopWebServer.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopState from "./DesktopState.ts";

export class DesktopAlreadyRunningError extends Schema.TaggedError<DesktopAlreadyRunningError>()(
  "DesktopAlreadyRunningError",
  {},
) {
  override get message(): string {
    return "Another Multiplex desktop instance is already running.";
  }
}

const startup = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;

  const hasSingleInstanceLock = yield* electronApp.requestSingleInstanceLock;
  if (!hasSingleInstanceLock) {
    yield* electronApp.quit;
    return yield* new DesktopAlreadyRunningError();
  }

  yield* electronApp.setPath("userData", environment.stateDirectory);
  if (environment.platform === "linux") {
    yield* electronApp.appendCommandLineSwitch("class", "multiplex");
    yield* electronApp.appendCommandLineSwitch("ozone-platform", "x11");
  }
  yield* lifecycle.register;
  yield* electronApp.whenReady;

  const webServer = yield* DesktopWebServer.DesktopWebServer;
  const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
  yield* electronProtocol.register(webServer.origin);
  yield* installDesktopIpcHandlers;

  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const mainWindow = yield* desktopWindow.createMain;
  yield* lifecycle.bindMainWindow(mainWindow);
});

const run = Effect.gen(function* () {
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  yield* startup;
  yield* shutdown.awaitRequest;

  const player = yield* NativePlayer.NativePlayer;
  const webServer = yield* DesktopWebServer.DesktopWebServer;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  yield* player.shutdown;
  yield* webServer.stop;
  yield* electronWindow.destroyAll;
  yield* shutdown.markComplete;
});

export const program = Effect.scoped(
  run.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const state = yield* DesktopState.DesktopState;
        const electronApp = yield* ElectronApp.ElectronApp;
        yield* Ref.set(state.quitting, true);
        yield* Effect.sync(() => console.error("Multiplex desktop failed", cause));
        yield* electronApp.quit;
      }),
    ),
  ),
);

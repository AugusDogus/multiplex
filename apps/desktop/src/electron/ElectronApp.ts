import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { app } from "electron";

export class ElectronAppWhenReadyError extends Schema.TaggedError<ElectronAppWhenReadyError>()(
  "ElectronAppWhenReadyError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Electron did not finish application startup.";
  }
}

export class ElectronApp extends Context.Service<
  ElectronApp,
  {
    readonly whenReady: Effect.Effect<void, ElectronAppWhenReadyError>;
    readonly quit: Effect.Effect<void>;
    readonly requestSingleInstanceLock: Effect.Effect<boolean>;
    readonly setPath: (name: "userData", path: string) => Effect.Effect<void>;
    readonly appendCommandLineSwitch: (name: string, value?: string) => Effect.Effect<void>;
  }
>()("@multiplex/desktop/electron/ElectronApp") {}

export const make = ElectronApp.of({
  whenReady: Effect.tryPromise({
    try: () => app.whenReady(),
    catch: (cause) => new ElectronAppWhenReadyError({ cause }),
  }),
  quit: Effect.sync(() => app.quit()),
  requestSingleInstanceLock: Effect.sync(() => app.requestSingleInstanceLock()),
  setPath: (name, path) => Effect.sync(() => app.setPath(name, path)),
  appendCommandLineSwitch: (name, value) =>
    Effect.sync(() => {
      if (value === undefined) app.commandLine.appendSwitch(name);
      else app.commandLine.appendSwitch(name, value);
    }),
});

export const layer = Layer.succeed(ElectronApp, make);

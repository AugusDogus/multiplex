import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { BrowserWindow } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";

export class ElectronWindowCreateError extends Schema.TaggedError<ElectronWindowCreateError>()(
  "ElectronWindowCreateError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Electron could not create the Multiplex window.";
  }
}

export class ElectronWindow extends Context.Service<
  ElectronWindow,
  {
    readonly create: (
      options: BrowserWindowConstructorOptions,
    ) => Effect.Effect<BrowserWindow, ElectronWindowCreateError>;
    readonly main: Effect.Effect<Option.Option<BrowserWindow>>;
    readonly setMain: (window: BrowserWindow) => Effect.Effect<void>;
    readonly clearMain: (window: BrowserWindow) => Effect.Effect<void>;
    readonly revealMain: Effect.Effect<void>;
    readonly sendAll: (channel: string, payload: unknown) => Effect.Effect<void>;
    readonly destroyAll: Effect.Effect<void>;
  }
>()("@multiplex/desktop/electron/ElectronWindow") {}

const make = Effect.gen(function* () {
  const mainWindow = yield* Ref.make<Option.Option<BrowserWindow>>(Option.none());

  const liveMain = Ref.get(mainWindow).pipe(
    Effect.map(Option.filter((window) => !window.isDestroyed())),
  );

  return ElectronWindow.of({
    create: (options) =>
      Effect.try({
        try: () => new BrowserWindow(options),
        catch: (cause) => new ElectronWindowCreateError({ cause }),
      }),
    main: liveMain,
    setMain: (window) => Ref.set(mainWindow, Option.some(window)),
    clearMain: (window) =>
      Ref.update(mainWindow, (current) =>
        Option.isSome(current) && current.value === window ? Option.none() : current,
      ),
    revealMain: liveMain.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (window) =>
            Effect.sync(() => {
              if (window.isMinimized()) window.restore();
              window.show();
              window.focus();
            }),
        }),
      ),
    ),
    sendAll: (channel, payload) =>
      Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload);
        }
      }),
    destroyAll: Effect.sync(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.destroy();
      }
    }),
  });
});

export const layer = Layer.effect(ElectronWindow, make);

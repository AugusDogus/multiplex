import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { shell } from "electron";
import type { BrowserWindow } from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";

export class DesktopWindowError extends Schema.TaggedError<DesktopWindowError>()(
  "DesktopWindowError",
  { operation: Schema.Literals(["create", "load"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `The desktop window failed to ${this.operation}.`;
  }
}

export class DesktopWindow extends Context.Service<
  DesktopWindow,
  {
    readonly createMain: Effect.Effect<BrowserWindow, DesktopWindowError>;
    readonly ensureMain: Effect.Effect<BrowserWindow, DesktopWindowError>;
    readonly activate: Effect.Effect<void, DesktopWindowError>;
  }
>()("@multiplex/desktop/window/DesktopWindow") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;

  const createMain = Effect.gen(function* () {
    const window = yield* electronWindow
      .create({
        title: "Multiplex",
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false,
        transparent: true,
        backgroundColor: "#00000000",
        titleBarStyle: environment.platform === "darwin" ? "hiddenInset" : "hidden",
        webPreferences: {
          preload: environment.preloadPath,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      })
      .pipe(Effect.mapError((cause) => new DesktopWindowError({ operation: "create", cause })));

    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          void shell.openExternal(url);
        }
      } catch {
        return { action: "deny" };
      }
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      try {
        const parsed = new URL(url);
        const isRenderer =
          parsed.protocol === `${environment.rendererScheme}:` && parsed.hostname === "app";
        const isPlexAuthentication =
          parsed.protocol === "https:" &&
          (parsed.hostname === "app.plex.tv" || parsed.hostname === "plex.tv");
        if (!isRenderer && !isPlexAuthentication) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      void Effect.runPromise(electronWindow.clearMain(window));
    });
    yield* electronWindow.setMain(window);
    yield* Effect.tryPromise({
      try: () => window.loadURL(environment.rendererOrigin.href),
      catch: (cause) => new DesktopWindowError({ operation: "load", cause }),
    });
    return window;
  });

  const ensureMain = electronWindow.main.pipe(
    Effect.flatMap(Option.match({ onNone: () => createMain, onSome: Effect.succeed })),
  );

  return DesktopWindow.of({
    createMain,
    ensureMain,
    activate: ensureMain.pipe(
      Effect.tap(() => electronWindow.revealMain),
      Effect.asVoid,
    ),
  });
});

export const layer = Layer.effect(DesktopWindow, make);

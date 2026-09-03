import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import { app } from "electron";
import type { BrowserWindow, Event } from "electron";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as NativePlayer from "../player/NativePlayer.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

export class DesktopLifecycle extends Context.Service<
  DesktopLifecycle,
  {
    readonly register: Effect.Effect<void, never, Scope.Scope>;
    readonly bindMainWindow: (window: BrowserWindow) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@multiplex/desktop/app/DesktopLifecycle") {}

const reportNativeFailure = <A>(effect: Effect.Effect<A, unknown>): void => {
  Effect.runFork(
    effect.pipe(
      Effect.tapError((cause) =>
        Effect.sync(() => console.error("Native player operation failed", cause)),
      ),
      Effect.ignore,
    ),
  );
};

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const nativePlayer = yield* NativePlayer.NativePlayer;

  return DesktopLifecycle.of({
    register: Effect.acquireRelease(
      Effect.sync(() => {
        let quitAllowed = false;
        const beforeQuit = (event: Event) => {
          if (quitAllowed) return;
          event.preventDefault();
          void Effect.runPromise(
            Ref.getAndSet(state.quitting, true).pipe(
              Effect.flatMap((alreadyQuitting) =>
                alreadyQuitting
                  ? Effect.void
                  : shutdown.request.pipe(
                      Effect.andThen(shutdown.awaitComplete),
                      Effect.tap(() => Effect.sync(() => (quitAllowed = true))),
                      Effect.andThen(electronApp.quit),
                    ),
              ),
            ),
          );
        };
        const activate = () => {
          void Effect.runPromise(desktopWindow.activate);
        };
        const secondInstance = () => {
          void Effect.runPromise(electronWindow.revealMain);
        };
        const allWindowsClosed = () => {
          if (environment.platform !== "darwin") {
            void Effect.runPromise(electronApp.quit);
          }
        };
        app.on("before-quit", beforeQuit);
        app.on("activate", activate);
        app.on("second-instance", secondInstance);
        app.on("window-all-closed", allWindowsClosed);
        return { activate, allWindowsClosed, beforeQuit, secondInstance };
      }),
      (listeners) =>
        Effect.sync(() => {
          app.removeListener("before-quit", listeners.beforeQuit);
          app.removeListener("activate", listeners.activate);
          app.removeListener("second-instance", listeners.secondInstance);
          app.removeListener("window-all-closed", listeners.allWindowsClosed);
        }),
    ).pipe(Effect.asVoid),
    bindMainWindow: (window) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const reconcile = () => reportNativeFailure(nativePlayer.reconcilePresentation);
          const suspend = () => reportNativeFailure(nativePlayer.suspendPresentation);
          window.on("move", reconcile);
          window.on("resize", reconcile);
          window.on("restore", reconcile);
          window.on("enter-full-screen", reconcile);
          window.on("leave-full-screen", reconcile);
          window.on("minimize", suspend);
          window.on("hide", suspend);
          window.on("closed", suspend);
          return { reconcile, suspend };
        }),
        ({ reconcile, suspend }) =>
          Effect.sync(() => {
            if (window.isDestroyed()) return;
            window.removeListener("move", reconcile);
            window.removeListener("resize", reconcile);
            window.removeListener("restore", reconcile);
            window.removeListener("enter-full-screen", reconcile);
            window.removeListener("leave-full-screen", reconcile);
            window.removeListener("minimize", suspend);
            window.removeListener("hide", suspend);
            window.removeListener("closed", suspend);
          }),
      ).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(DesktopLifecycle, make);

import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { app } from "electron";

export interface DesktopEnvironmentValue {
  readonly isDevelopment: boolean;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly rootDirectory: string;
  readonly stateDirectory: string;
  readonly preloadPath: string;
  readonly webServerEntryPath: string;
  readonly libmpvAddonPath: string;
  readonly developmentServerUrl: URL | null;
  readonly rendererScheme: "multiplex" | "multiplex-dev";
  readonly rendererOrigin: URL;
}

export class DesktopEnvironment extends Context.Service<
  DesktopEnvironment,
  DesktopEnvironmentValue
>()("@multiplex/desktop/app/DesktopEnvironment") {}

export const make = (dirname: string): DesktopEnvironmentValue => {
  const developmentServer = process.env.MULTIPLEX_DESKTOP_DEV_SERVER_URL;
  const developmentServerUrl = developmentServer ? new URL(developmentServer) : null;
  const isDevelopment = developmentServerUrl !== null;
  const rendererScheme = isDevelopment ? "multiplex-dev" : "multiplex";
  const rootDirectory = resolve(dirname, "../../..");
  const stateDirectory = join(homedir(), ".multiplex", isDevelopment ? "desktop-dev" : "desktop");

  return DesktopEnvironment.of({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    rootDirectory,
    stateDirectory,
    preloadPath: join(dirname, "preload.cjs"),
    webServerEntryPath: app.isPackaged
      ? join(process.resourcesPath, "web", "server.js")
      : join(rootDirectory, "apps", "web", ".next", "standalone", "server.js"),
    libmpvAddonPath: app.isPackaged
      ? join(process.resourcesPath, "libmpv", "multiplex_libmpv.node")
      : join(rootDirectory, "packages", "libmpv", "build", "Release", "multiplex_libmpv.node"),
    developmentServerUrl,
    rendererScheme,
    rendererOrigin: new URL(`${rendererScheme}://app/`),
  });
};

export const layer = (dirname: string) => Layer.succeed(DesktopEnvironment, make(dirname));

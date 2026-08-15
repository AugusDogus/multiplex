import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPOSITORY_CHROME_PATH = path.join(
  WORKSPACE_ROOT,
  ".watch-together-harness",
  "chrome",
  "opt",
  "google",
  "chrome",
  "google-chrome",
);

export type ChromeLaunchTarget =
  | { readonly kind: "executable"; readonly executablePath: string }
  | { readonly kind: "channel"; readonly channel: string }
  | { readonly kind: "bundled-chromium" };

interface ChromeEnvironment {
  readonly [name: string]: unknown;
  readonly PLAYWRIGHT_EXECUTABLE_PATH?: string;
  readonly WATCH_TOGETHER_HARNESS_CHROME_PATH?: string;
  readonly PLAYWRIGHT_CHANNEL?: string;
}

export function resolveChromeLaunchTarget(
  environment: ChromeEnvironment,
  options: {
    readonly workspaceRoot?: string;
    readonly pathExists?: (candidate: string) => boolean;
  } = {},
): ChromeLaunchTarget {
  const workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT;
  const pathExists = options.pathExists ?? existsSync;
  const configuredPath =
    environment.PLAYWRIGHT_EXECUTABLE_PATH?.trim() ||
    environment.WATCH_TOGETHER_HARNESS_CHROME_PATH?.trim();
  if (configuredPath) {
    const executablePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(workspaceRoot, configuredPath);
    if (!pathExists(executablePath)) {
      throw new Error(`Configured Chrome executable does not exist: ${executablePath}`);
    }
    return { kind: "executable", executablePath };
  }

  const repositoryChromePath =
    workspaceRoot === WORKSPACE_ROOT
      ? REPOSITORY_CHROME_PATH
      : path.join(
          workspaceRoot,
          ".watch-together-harness",
          "chrome",
          "opt",
          "google",
          "chrome",
          "google-chrome",
        );
  if (pathExists(repositoryChromePath)) {
    return { kind: "executable", executablePath: repositoryChromePath };
  }

  const requestedChannel = environment.PLAYWRIGHT_CHANNEL?.trim();
  return requestedChannel === "chromium"
    ? { kind: "bundled-chromium" }
    : { kind: "channel", channel: requestedChannel || "chrome" };
}

export function chromeLaunchFields(target: ChromeLaunchTarget): {
  readonly channel?: string;
  readonly executablePath?: string;
} {
  switch (target.kind) {
    case "executable":
      return { executablePath: target.executablePath };
    case "channel":
      return { channel: target.channel };
    case "bundled-chromium":
      return {};
  }
}

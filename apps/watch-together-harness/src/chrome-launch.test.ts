import { describe, expect, test } from "bun:test";

import { chromeLaunchFields, resolveChromeLaunchTarget } from "./chrome-launch";

describe("resolveChromeLaunchTarget", () => {
  test("prefers the repository Chrome installation", () => {
    const target = resolveChromeLaunchTarget(
      {},
      {
        workspaceRoot: "/repo",
        pathExists: (candidate) => candidate.endsWith("google-chrome"),
      },
    );

    expect(target).toEqual({
      kind: "executable",
      executablePath: "/repo/.watch-together-harness/chrome/opt/google/chrome/google-chrome",
    });
    expect(chromeLaunchFields(target)).toEqual({
      executablePath: "/repo/.watch-together-harness/chrome/opt/google/chrome/google-chrome",
    });
  });

  test("honors an explicit workspace-relative executable", () => {
    expect(
      resolveChromeLaunchTarget(
        { PLAYWRIGHT_EXECUTABLE_PATH: "tools/chrome" },
        { workspaceRoot: "/repo", pathExists: () => true },
      ),
    ).toEqual({ kind: "executable", executablePath: "/repo/tools/chrome" });
  });

  test("falls back to the requested channel when repository Chrome is absent", () => {
    expect(
      resolveChromeLaunchTarget(
        { PLAYWRIGHT_CHANNEL: "chrome-beta" },
        { workspaceRoot: "/repo", pathExists: () => false },
      ),
    ).toEqual({ kind: "channel", channel: "chrome-beta" });
  });
});

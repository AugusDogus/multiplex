import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveAccountCredentials, tokenFileSchema, writeTokenFile } from "./authenticate";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Watch Together harness authentication", () => {
  test("resolves explicit credentials before compatibility fallbacks", () => {
    const credentials = resolveAccountCredentials({
      WATCH_TOGETHER_ACCOUNT_A_EMAIL: "explicit-a@example.test",
      WATCH_TOGETHER_ACCOUNT_A_PASSWORD: "explicit-a-password",
      WATCH_TOGETHER_ACCOUNT_B_EMAIL: "explicit-b@example.test",
      WATCH_TOGETHER_ACCOUNT_B_PASSWORD: "explicit-b-password",
      MULTIPLEX_ACCOUNT_EMAIL: "fallback-a@example.test",
      MULTIPLEX_ACCOUNT_PASSWORD: "fallback-a-password",
      MUTLIPLEX_ACCOUNT_EMAIL_2: "fallback-b@example.test",
      MULTIPLEX_ACCOUNT_PASSWORD_2: "fallback-b-password",
    });

    expect(credentials).toEqual({
      accountA: {
        email: "explicit-a@example.test",
        password: "explicit-a-password",
      },
      accountB: {
        email: "explicit-b@example.test",
        password: "explicit-b-password",
      },
    });
  });

  test("supports the existing two-account environment names", () => {
    const credentials = resolveAccountCredentials({
      MULTIPLEX_ACCOUNT_EMAIL: "account-a@example.test",
      MULTIPLEX_ACCOUNT_PASSWORD: "account-a-password",
      MUTLIPLEX_ACCOUNT_EMAIL_2: "account-b@example.test",
      MULTIPLEX_ACCOUNT_PASSWORD_2: "account-b-password",
    });

    expect(credentials.accountA.email).toBe("account-a@example.test");
    expect(credentials.accountB.email).toBe("account-b@example.test");
  });

  test("writes only the validated token shape with mode 0600", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "multiplex-watch-harness-auth-"));
    temporaryDirectories.push(directory);
    const tokenPath = path.join(directory, "private", "tokens.json");

    await writeTokenFile(tokenPath, {
      accountA: { token: "account-a-token" },
      accountB: { token: "account-b-token" },
    });

    const fileStat = await stat(tokenPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
    const parsed: unknown = JSON.parse(await readFile(tokenPath, "utf8"));
    expect(tokenFileSchema.parse(parsed)).toEqual({
      accountA: { token: "account-a-token" },
      accountB: { token: "account-b-token" },
    });
  });
});

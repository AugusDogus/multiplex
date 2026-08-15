#!/usr/bin/env bun

import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { z } from "zod";

import { chromeLaunchFields, resolveChromeLaunchTarget } from "../src/chrome-launch";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_STORAGE_STATE = path.join(
  WORKSPACE_ROOT,
  "apps",
  "web",
  "e2e",
  ".auth",
  "account-a.json",
);

const environmentSchema = z
  .object({
    MULTIPLEX_BASE_URL: z.string().url().optional(),
    GAMECUBE_LINK_ACCOUNT_STATE: z.string().optional(),
    WATCH_TOGETHER_HARNESS_CHROME_PATH: z.string().optional(),
  })
  .passthrough();
const codeSchema = z.string().regex(/^[A-Z2-9]{4}$/);

function resolvePath(value: string | undefined, fallback: string): string {
  const selected = value?.trim() || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(WORKSPACE_ROOT, selected);
}

export async function claimGameCube(code: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const parsedEnvironment = environmentSchema.parse(environment);
  const normalizedCode = codeSchema.parse(code.trim().toUpperCase());
  const baseUrl = new URL(parsedEnvironment.MULTIPLEX_BASE_URL ?? "https://multiplex.localhost");
  const storageState = resolvePath(
    parsedEnvironment.GAMECUBE_LINK_ACCOUNT_STATE,
    DEFAULT_STORAGE_STATE,
  );
  const chromeLaunch = chromeLaunchFields(resolveChromeLaunchTarget(parsedEnvironment));
  await access(storageState);

  const browser = await chromium.launch({
    channel: chromeLaunch.channel,
    executablePath: chromeLaunch.executablePath,
    headless: true,
  });
  try {
    const context = await browser.newContext({ storageState });
    try {
      const page = await context.newPage();
      const linkUrl = new URL("/link", baseUrl);
      linkUrl.searchParams.set("user_code", normalizedCode);
      await page.goto(linkUrl.href, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /link console/i }).click();
      await page.getByText("Console linked", { exact: true }).waitFor({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const code = process.argv[2];
  if (!code) {
    throw new Error("Usage: bun claim-gamecube.ts <four-character-code>");
  }
  await claimGameCube(code, process.env);
  console.log("The live GameCube console was linked.");
}

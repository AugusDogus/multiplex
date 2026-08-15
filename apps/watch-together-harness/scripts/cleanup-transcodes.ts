#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PlexTvClient } from "@multiplex/plex-query";
import { z } from "zod";

import { resolveTokenFilePath, tokenFileSchema } from "./authenticate";

const DEFAULT_SERVER_ID = "0019947d618464e70d2b754687dc070b9dd628a9";

const environmentSchema = z
  .object({
    WATCH_TOGETHER_HARNESS_SERVER_ID: z.string().min(1).optional(),
    WATCH_TOGETHER_HARNESS_TOKEN_FILE: z.string().optional(),
  })
  .passthrough();

const accountSchema = z.enum(["accountA", "accountB", "all"]);
type Account = Exclude<z.infer<typeof accountSchema>, "all">;

export function transcodeSessionKeys(xml: string): readonly string[] {
  return Array.from(xml.matchAll(/<TranscodeSession\b[^>]*\bkey="([^"]+)"/g))
    .map((match) => match[1])
    .filter((key): key is string => key !== undefined);
}

async function cleanupAccount(account: Account, token: string, serverId: string): Promise<number> {
  const client = new PlexTvClient(token, {
    product: "Multiplex Watch Together Cleanup",
    version: "1.0.0",
    platform: "Node",
    clientIdentifier: `multiplex-watch-together-cleanup-${randomUUID()}`,
  });
  const server = (await client.getServers()).find(
    (candidate) => candidate.clientIdentifier === serverId,
  );
  if (!server) {
    throw new Error(`${account} cannot access Plex server ${serverId}; no sessions were changed.`);
  }

  const serverUrl = await client.createServerClient(server).getConnectionUri();
  const serverToken = server.accessToken ?? token;
  const headers = { "X-Plex-Token": serverToken };
  const listResponse = await fetch(new URL("/transcode/sessions", serverUrl), { headers });
  if (!listResponse.ok) {
    throw new Error(
      `${account} could not list Plex transcode sessions (HTTP ${listResponse.status}); no sessions were stopped.`,
    );
  }

  const sessionKeys = transcodeSessionKeys(await listResponse.text());
  for (const sessionKey of sessionKeys) {
    const stopUrl = new URL("/video/:/transcode/universal/stop", serverUrl);
    stopUrl.searchParams.set("session", sessionKey);
    const stopResponse = await fetch(stopUrl, { headers });
    if (!stopResponse.ok && stopResponse.status !== 404) {
      throw new Error(
        `${account} could not stop a Plex transcode session (HTTP ${stopResponse.status}); remaining sessions were preserved.`,
      );
    }
  }
  return sessionKeys.length;
}

export async function cleanupTranscodes(
  environment: NodeJS.ProcessEnv,
  selection: z.infer<typeof accountSchema>,
): Promise<Readonly<Record<Account, number | null>>> {
  const parsedEnvironment = environmentSchema.parse(environment);
  const tokenFilePath = resolveTokenFilePath(parsedEnvironment);
  const tokens = tokenFileSchema.parse(JSON.parse(await readFile(tokenFilePath, "utf8")));
  const serverId = parsedEnvironment.WATCH_TOGETHER_HARNESS_SERVER_ID ?? DEFAULT_SERVER_ID;
  const accounts: readonly Account[] = selection === "all" ? ["accountA", "accountB"] : [selection];
  const result: Record<Account, number | null> = { accountA: null, accountB: null };

  for (const account of accounts) {
    result[account] = await cleanupAccount(account, tokens[account].token, serverId);
  }
  return result;
}

if (import.meta.main) {
  const selection = accountSchema.parse(process.argv[2] ?? "all");
  const result = await cleanupTranscodes(process.env, selection);
  for (const account of ["accountA", "accountB"] as const) {
    const stopped = result[account];
    if (stopped !== null) console.log(`Stopped ${stopped} ${account} Plex transcode session(s).`);
  }
}

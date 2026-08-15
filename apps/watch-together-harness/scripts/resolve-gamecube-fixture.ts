#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PlexTvClient, type PlexDevice } from "@multiplex/plex-query";
import { z } from "zod";

import { resolveTokenFilePath, tokenFileSchema } from "./authenticate";

const DEFAULT_SERVER_ID = "0019947d618464e70d2b754687dc070b9dd628a9";

const environmentSchema = z
  .object({
    WATCH_TOGETHER_HARNESS_SERVER_ID: z.string().min(1).optional(),
    WATCH_TOGETHER_HARNESS_TOKEN_FILE: z.string().optional(),
  })
  .passthrough();

interface FixtureItem {
  readonly ratingKey: string;
  readonly title: string;
}

export function firstGameCubeHomeItem(
  hubs: readonly {
    readonly hubIdentifier: string;
    readonly items: readonly FixtureItem[];
  }[],
): FixtureItem | null {
  const continueHub = hubs.find(
    (hub) => hub.hubIdentifier.includes(".continue") || hub.hubIdentifier.includes(".inprogress"),
  );
  return continueHub?.items[0] ?? null;
}

function requireServer(servers: readonly PlexDevice[], serverId: string): PlexDevice {
  const server = servers.find((candidate) => candidate.clientIdentifier === serverId);
  if (!server) throw new Error(`Account A cannot access Plex server ${serverId}.`);
  return server;
}

async function resolveFixture(environment: NodeJS.ProcessEnv): Promise<{
  readonly current: FixtureItem;
  readonly next: FixtureItem;
}> {
  const parsedEnvironment = environmentSchema.parse(environment);
  const tokenFilePath = resolveTokenFilePath(parsedEnvironment);
  const tokens = tokenFileSchema.parse(JSON.parse(await readFile(tokenFilePath, "utf8")));
  const serverId = parsedEnvironment.WATCH_TOGETHER_HARNESS_SERVER_ID ?? DEFAULT_SERVER_ID;
  const client = new PlexTvClient(tokens.accountA.token, {
    product: "Multiplex GameCube Fixture Resolver",
    version: "1.0.0",
    platform: "Node",
    clientIdentifier: `multiplex-gamecube-fixture-${randomUUID()}`,
  });
  const server = requireServer(await client.getServers(), serverId);
  const serverClient = client.createServerClient(server);
  const current = firstGameCubeHomeItem(
    (await serverClient.getHubs({ count: 8, onlyTransient: true })).hubs,
  );
  if (!current) {
    throw new Error("GameCube Home has no Continue Watching item; no test was started.");
  }

  const queue = await serverClient.createPlayQueue({
    type: "video",
    uri: `server://${serverId}/com.plexapp.plugins.library/library/metadata/${current.ratingKey}`,
    continuous: true,
    includeMarkers: true,
    includeChapters: true,
    shuffle: false,
    repeat: 0,
  });
  const items = queue.MediaContainer.Metadata ?? [];
  const currentIndex = items.findIndex((item) => item.ratingKey === current.ratingKey);
  const next = currentIndex >= 0 ? items[currentIndex + 1] : undefined;
  if (!next) {
    throw new Error(
      `The first GameCube Home item (${current.ratingKey}) has no successor; no test was started.`,
    );
  }
  return { current, next };
}

if (import.meta.main) {
  const fixture = await resolveFixture(process.env);
  console.log(`${fixture.current.ratingKey}\t${fixture.next.ratingKey}`);
}

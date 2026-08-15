import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PlexTvClient } from "@multiplex/plex-query";
import { z } from "zod";

import { tokenFileSchema } from "./authenticate";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_TOKEN_FILE = path.join(WORKSPACE_ROOT, ".watch-together-harness", "tokens.json");
const DEFAULT_GAMECUBE_CACHE = path.join(WORKSPACE_ROOT, "apps", "gamecube", ".plex-cache");
const DEFAULT_STORAGE_STATE = path.join(
  WORKSPACE_ROOT,
  "apps",
  "web",
  "e2e",
  ".auth",
  "account-a.json",
);
const DEFAULT_SERVER_ID = "0019947d618464e70d2b754687dc070b9dd628a9";

const environmentSchema = z
  .object({
    MULTIPLEX_BASE_URL: z.string().url().optional(),
    WATCH_TOGETHER_HARNESS_TOKEN_FILE: z.string().optional(),
    WATCH_TOGETHER_HARNESS_ACCOUNT_A_STATE: z.string().optional(),
    GAMECUBE_PLEX_AUTH_STATE: z.string().optional(),
    GAMECUBE_MULTIPLEX_DEVICE_STATE: z.string().optional(),
    WATCH_TOGETHER_HARNESS_SERVER_ID: z.string().min(1).optional(),
  })
  .passthrough();

const storageStateSchema = z.object({
  cookies: z.array(
    z.object({
      name: z.string().min(1),
      value: z.string(),
      domain: z.string().min(1),
      path: z.string().min(1),
      expires: z.number(),
      secure: z.boolean(),
    }),
  ),
});

const createdPairingSchema = z.object({
  deviceId: z.string().uuid(),
  deviceSecret: z.string().min(32),
  code: z.string().length(4),
  expiresAt: z.string().datetime(),
  linkPath: z.string().min(1),
});

const claimedPairingSchema = z.object({
  status: z.literal("linked"),
  device: z.object({ id: z.string().uuid() }),
});

const linkedPairingSchema = z.object({
  status: z.literal("linked"),
  deviceId: z.string().uuid(),
  credentialExpiresAt: z.string().datetime(),
});
const currentUserEnvelopeSchema = z.object({
  result: z.object({
    data: z.object({
      json: z.object({
        id: z.number(),
        username: z.string(),
      }),
    }),
  }),
});

class ProvisioningError extends Error {}

export function assertMatchingAccountIdentities(
  plexIdentity: { readonly id: number; readonly username: string },
  multiplexIdentity: { readonly id: number; readonly username: string },
): void {
  if (plexIdentity.id === multiplexIdentity.id) return;
  throw new ProvisioningError(
    `Account A identity mismatch: the Plex token belongs to ${plexIdentity.username} (${plexIdentity.id}), but the saved Multiplex browser session belongs to ${multiplexIdentity.username} (${multiplexIdentity.id}). Refresh account-a.json with the same account before provisioning. No private state was changed.`,
  );
}

function resolvePath(value: string | undefined, fallback: string): string {
  const selected = value?.trim() || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(WORKSPACE_ROOT, selected);
}

async function readJson(pathname: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch {
    throw new ProvisioningError(`Could not read valid JSON from ${pathname}.`);
  }
}

async function writePrivateJson(pathname: string, value: unknown): Promise<void> {
  const temporaryPath = `${pathname}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, pathname);
    await chmod(pathname, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function cookieHeader(
  storageState: z.infer<typeof storageStateSchema>,
  target: URL,
  nowSeconds = Date.now() / 1_000,
): string {
  const hostname = target.hostname;
  const pathname = target.pathname;
  return storageState.cookies
    .filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, "");
      const matchesDomain = hostname === domain || hostname.endsWith(`.${domain}`);
      const unexpired = cookie.expires < 0 || cookie.expires > nowSeconds;
      return (
        matchesDomain &&
        pathname.startsWith(cookie.path) &&
        unexpired &&
        (!cookie.secure || target.protocol === "https:")
      );
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ProvisioningError(
      `${operation} returned unreadable JSON with HTTP ${response.status}. No private state was changed.`,
    );
  }
  if (!response.ok) {
    throw new ProvisioningError(
      `${operation} failed with HTTP ${response.status}. Refresh the account A Playwright login and retry.`,
    );
  }
  return value;
}

export async function provisionGameCube(environment: NodeJS.ProcessEnv): Promise<{
  readonly plexAuthStatePath: string;
  readonly consoleDeviceStatePath: string;
}> {
  const parsedEnvironment = environmentSchema.parse(environment);
  const baseUrl = new URL(parsedEnvironment.MULTIPLEX_BASE_URL ?? "https://multiplex.localhost");
  const tokenFilePath = resolvePath(
    parsedEnvironment.WATCH_TOGETHER_HARNESS_TOKEN_FILE,
    DEFAULT_TOKEN_FILE,
  );
  const storageStatePath = resolvePath(
    parsedEnvironment.WATCH_TOGETHER_HARNESS_ACCOUNT_A_STATE,
    DEFAULT_STORAGE_STATE,
  );
  const plexAuthStatePath = resolvePath(
    parsedEnvironment.GAMECUBE_PLEX_AUTH_STATE,
    path.join(DEFAULT_GAMECUBE_CACHE, "auth.json"),
  );
  const consoleDeviceStatePath = resolvePath(
    parsedEnvironment.GAMECUBE_MULTIPLEX_DEVICE_STATE,
    path.join(DEFAULT_GAMECUBE_CACHE, "multiplex-device.json"),
  );

  const tokens = tokenFileSchema.parse(await readJson(tokenFilePath));
  const storageState = storageStateSchema.parse(await readJson(storageStatePath));
  const plexClient = new PlexTvClient(tokens.accountA.token, {
    product: "Multiplex GameCube QA Provisioner",
    version: "1.0.0",
    platform: "Node",
    clientIdentifier: `multiplex-gamecube-qa-${randomUUID()}`,
  });
  const plexIdentity = await plexClient.getUserInfo();
  const serverId = parsedEnvironment.WATCH_TOGETHER_HARNESS_SERVER_ID ?? DEFAULT_SERVER_ID;
  const server = (await plexClient.getServers()).find(
    (candidate) => candidate.clientIdentifier === serverId,
  );
  if (!server) {
    throw new ProvisioningError(
      `Account A cannot access Plex server ${serverId}. No private state was changed.`,
    );
  }
  const serverClient = plexClient.createServerClient(server);
  const plexServerUrl = await serverClient.getConnectionUri();
  const plexServerToken = server.accessToken ?? tokens.accountA.token;

  const claimUrl = new URL("/api/console/pairings/claim", baseUrl);
  const cookies = cookieHeader(storageState, claimUrl);
  if (!cookies) {
    throw new ProvisioningError(
      `No valid account A session cookie was found in ${storageStatePath}. Refresh the Playwright login and retry.`,
    );
  }
  const currentUserUrl = new URL(
    "/api/trpc/plex.getUserInfo?input=%7B%22json%22%3Anull%7D",
    baseUrl,
  );
  const multiplexIdentity = currentUserEnvelopeSchema.parse(
    await responseJson(
      await fetch(currentUserUrl, { headers: { cookie: cookies } }),
      "Multiplex account identity verification",
    ),
  ).result.data.json;
  assertMatchingAccountIdentities(plexIdentity, multiplexIdentity);

  const createUrl = new URL("/api/console/pairings", baseUrl);
  const created = createdPairingSchema.parse(
    await responseJson(
      await fetch(createUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "gamecube",
          name: "Nintendo GameCube QA",
        }),
      }),
      "GameCube pairing creation",
    ),
  );

  const claimed = claimedPairingSchema.parse(
    await responseJson(
      await fetch(claimUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies },
        body: JSON.stringify({ code: created.code }),
      }),
      "GameCube pairing claim",
    ),
  );
  if (claimed.device.id !== created.deviceId) {
    throw new ProvisioningError(
      "Multiplex linked a different GameCube device. No private state was changed.",
    );
  }

  const pollUrl = new URL("/api/console/pairings/poll", baseUrl);
  const linked = linkedPairingSchema.parse(
    await responseJson(
      await fetch(pollUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: created.deviceId,
          deviceSecret: created.deviceSecret,
        }),
      }),
      "GameCube pairing verification",
    ),
  );

  await writePrivateJson(plexAuthStatePath, {
    version: 1,
    pmsAuthToken: plexServerToken,
    pmsClaimedAt: Math.floor(Date.now() / 1_000),
    plexServerUrl,
  });
  await writePrivateJson(consoleDeviceStatePath, {
    version: 1,
    baseUrl: baseUrl.origin,
    deviceId: linked.deviceId,
    deviceSecret: created.deviceSecret,
    status: "linked",
    credentialExpiresAt: linked.credentialExpiresAt,
  });

  return { plexAuthStatePath, consoleDeviceStatePath };
}

if (import.meta.main) {
  try {
    const result = await provisionGameCube(process.env);
    console.log(`Provisioned private Plex state at ${result.plexAuthStatePath}.`);
    console.log(`Provisioned private Multiplex device state at ${result.consoleDeviceStatePath}.`);
  } catch (error) {
    console.error(
      error instanceof ProvisioningError
        ? error.message
        : "GameCube provisioning failed unexpectedly. No credentials, tokens, or device secrets were printed.",
    );
    process.exitCode = 1;
  }
}

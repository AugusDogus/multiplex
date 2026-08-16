import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { and, count, eq, gt, gte, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import {
  consoleDevice,
  consolePairingClaimAttempt,
  user,
} from "~/server/db/schema";

const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_CODE_LENGTH = 4;
const PAIRING_LIFETIME_MS = 5 * 60 * 1_000;
const CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_CODE_INSERT_ATTEMPTS = 8;
const CLAIM_ATTEMPT_WINDOW_MS = 10 * 60 * 1_000;
const MAX_CLAIM_ATTEMPTS_PER_WINDOW = 10;

export const consolePlatformSchema = z.enum([
  "gamecube",
  "wii",
  "dreamcast",
  "xbox",
  "ps2",
]);

export const createConsolePairingSchema = z.object({
  platform: consolePlatformSchema,
  name: z.string().trim().min(1).max(64).optional(),
});

export const pollConsolePairingSchema = z.object({
  deviceId: z.string().uuid(),
  deviceSecret: z.string().min(32).max(128),
});

export const consoleDeviceCredentialSchema = pollConsolePairingSchema;

export const claimConsolePairingSchema = z.object({
  code: z.string().transform(normalizePairingCode).pipe(z.string().length(4)),
});

export async function parseConsolePairingRequest<Output>(
  request: Request,
  schema: z.ZodType<Output>,
): Promise<Output | null> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type ConsolePlatform = z.infer<typeof consolePlatformSchema>;
type PairingDatabase = Pick<typeof db, "insert" | "select" | "update">;

interface PairingDependencies {
  database?: PairingDatabase;
  now?: Date;
  randomCode?: () => string;
  randomDeviceId?: () => string;
  randomDeviceSecret?: () => string;
}

export interface CreatedConsolePairing {
  deviceId: string;
  deviceSecret: string;
  code: string;
  expiresAt: string;
  linkPath: "/link";
}

export type ConsolePairingStatus =
  | { status: "waiting"; expiresAt: string }
  | {
      status: "linked";
      deviceId: string;
      credentialExpiresAt: string;
    }
  | { status: "expired" }
  | { status: "invalid-credential" };

export type ConsolePairingClaim =
  | {
      status: "linked";
      device: { id: string; name: string; platform: ConsolePlatform };
    }
  | { status: "invalid-code" }
  | { status: "rate-limited" };

export interface AuthenticatedConsoleDevice {
  device: {
    id: string;
    name: string;
    platform: ConsolePlatform;
    credentialExpiresAt: Date;
  };
  user: {
    id: string;
    plexAuthToken: string | null;
  };
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export function generatePairingCode(
  randomIndex: (maximum: number) => number = randomInt,
): string {
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[randomIndex(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function hashConsoleCredential(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function parseConsoleDeviceAuthorization(
  authorization: string | null,
): z.infer<typeof consoleDeviceCredentialSchema> | null {
  if (!authorization) return null;
  const separator = authorization.indexOf(" ");
  if (
    separator <= 0 ||
    authorization.slice(0, separator).toLowerCase() !== "multiplexdevice"
  ) {
    return null;
  }
  const credential = authorization.slice(separator + 1).trim();
  const credentialSeparator = credential.indexOf(":");
  if (credentialSeparator <= 0) return null;
  const parsed = consoleDeviceCredentialSchema.safeParse({
    deviceId: credential.slice(0, credentialSeparator),
    deviceSecret: credential.slice(credentialSeparator + 1),
  });
  return parsed.success ? parsed.data : null;
}

export async function authenticateConsoleDevice(
  input: z.infer<typeof consoleDeviceCredentialSchema>,
  dependencies: PairingDependencies = {},
): Promise<AuthenticatedConsoleDevice | null> {
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? new Date();
  const [result] = await database
    .select({
      deviceId: consoleDevice.id,
      deviceName: consoleDevice.name,
      platform: consoleDevice.platform,
      credentialHash: consoleDevice.credentialHash,
      credentialExpiresAt: consoleDevice.credentialExpiresAt,
      linkedAt: consoleDevice.linkedAt,
      revokedAt: consoleDevice.revokedAt,
      userId: user.id,
      plexAuthToken: user.plexAuthToken,
    })
    .from(consoleDevice)
    .innerJoin(user, eq(consoleDevice.userId, user.id))
    .where(eq(consoleDevice.id, input.deviceId))
    .limit(1);

  if (
    !result?.linkedAt ||
    result.revokedAt ||
    result.credentialExpiresAt <= now ||
    !credentialsMatch(input.deviceSecret, result.credentialHash)
  ) {
    return null;
  }

  await database
    .update(consoleDevice)
    .set({ lastSeenAt: now, updatedAt: now })
    .where(eq(consoleDevice.id, result.deviceId));

  return {
    device: {
      id: result.deviceId,
      name: result.deviceName,
      platform: result.platform,
      credentialExpiresAt: result.credentialExpiresAt,
    },
    user: {
      id: result.userId,
      plexAuthToken: result.plexAuthToken,
    },
  };
}

export async function createConsolePairing(
  input: z.infer<typeof createConsolePairingSchema>,
  dependencies: PairingDependencies = {},
): Promise<CreatedConsolePairing> {
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? new Date();
  const deviceId = dependencies.randomDeviceId?.() ?? randomUUID();
  const deviceSecret =
    dependencies.randomDeviceSecret?.() ??
    randomBytes(32).toString("base64url");
  const pairingExpiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS);
  const credentialExpiresAt = new Date(now.getTime() + CREDENTIAL_LIFETIME_MS);
  const name = input.name ?? defaultDeviceName(input.platform);

  for (let attempt = 0; attempt < MAX_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const code = dependencies.randomCode?.() ?? generatePairingCode();
    try {
      await database.insert(consoleDevice).values({
        id: deviceId,
        platform: input.platform,
        name,
        pairingCode: code,
        credentialHash: hashConsoleCredential(deviceSecret),
        pairingExpiresAt,
        credentialExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return {
        deviceId,
        deviceSecret,
        code,
        expiresAt: pairingExpiresAt.toISOString(),
        linkPath: "/link",
      };
    } catch (cause) {
      if (attempt === MAX_CODE_INSERT_ATTEMPTS - 1) {
        throw cause;
      }
    }
  }

  throw new Error("Failed to reserve a console pairing code");
}

export async function pollConsolePairing(
  input: z.infer<typeof pollConsolePairingSchema>,
  dependencies: PairingDependencies = {},
): Promise<ConsolePairingStatus> {
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? new Date();
  const [device] = await database
    .select()
    .from(consoleDevice)
    .where(eq(consoleDevice.id, input.deviceId))
    .limit(1);

  if (
    !device ||
    !credentialsMatch(input.deviceSecret, device.credentialHash) ||
    device.revokedAt ||
    device.credentialExpiresAt <= now
  ) {
    return { status: "invalid-credential" };
  }

  if (!device.userId || !device.linkedAt) {
    return device.pairingExpiresAt <= now
      ? { status: "expired" }
      : { status: "waiting", expiresAt: device.pairingExpiresAt.toISOString() };
  }

  await database
    .update(consoleDevice)
    .set({ lastSeenAt: now, updatedAt: now })
    .where(eq(consoleDevice.id, device.id));

  return {
    status: "linked",
    deviceId: device.id,
    credentialExpiresAt: device.credentialExpiresAt.toISOString(),
  };
}

export async function claimConsolePairing(
  userId: string,
  code: string,
  dependencies: PairingDependencies = {},
): Promise<ConsolePairingClaim> {
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? new Date();
  const attemptWindowStart = new Date(now.getTime() - CLAIM_ATTEMPT_WINDOW_MS);
  const [recentAttempts] = await database
    .select({ value: count() })
    .from(consolePairingClaimAttempt)
    .where(
      and(
        eq(consolePairingClaimAttempt.userId, userId),
        gte(consolePairingClaimAttempt.attemptedAt, attemptWindowStart),
      ),
    );
  if ((recentAttempts?.value ?? 0) >= MAX_CLAIM_ATTEMPTS_PER_WINDOW) {
    return { status: "rate-limited" };
  }

  await database.insert(consolePairingClaimAttempt).values({
    id: randomUUID(),
    userId,
    attemptedAt: now,
  });

  const [linkedDevice] = await database
    .update(consoleDevice)
    .set({
      userId,
      pairingCode: null,
      linkedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(consoleDevice.pairingCode, normalizePairingCode(code)),
        isNull(consoleDevice.userId),
        gt(consoleDevice.pairingExpiresAt, now),
        isNull(consoleDevice.revokedAt),
      ),
    )
    .returning({
      id: consoleDevice.id,
      name: consoleDevice.name,
      platform: consoleDevice.platform,
    });

  return linkedDevice
    ? { status: "linked", device: linkedDevice }
    : { status: "invalid-code" };
}

function credentialsMatch(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashConsoleCredential(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function defaultDeviceName(platform: ConsolePlatform): string {
  return platform === "gamecube"
    ? "Nintendo GameCube"
    : platform === "wii"
      ? "Nintendo Wii"
      : platform === "dreamcast"
        ? "Sega Dreamcast"
        : platform === "xbox"
          ? "Original Xbox"
          : "PlayStation 2";
}

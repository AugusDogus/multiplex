import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import {
  claimConsolePairing,
  createConsolePairing,
  generatePairingCode,
  hashConsoleCredential,
  normalizePairingCode,
  pollConsolePairing,
} from "~/server/console-pairing";
import * as schema from "~/server/db/schema";

const client = createClient({ url: "file::memory:" });
const database = drizzle(client, { schema });
const now = new Date("2026-07-28T14:00:00.000Z");
const userId = "test-user";
const deviceId = "123e4567-e89b-42d3-a456-426614174000";
const deviceSecret = "test-device-secret-with-more-than-32-characters";

describe("console pairing", () => {
  beforeAll(async () => {
    await client.batch(
      [
        `CREATE TABLE multiplex_user (
          id TEXT PRIMARY KEY NOT NULL
        )`,
        `CREATE TABLE multiplex_console_device (
          id TEXT PRIMARY KEY NOT NULL,
          platform TEXT NOT NULL,
          name TEXT NOT NULL,
          pairing_code TEXT,
          credential_hash TEXT NOT NULL,
          pairing_expires_at INTEGER NOT NULL,
          credential_expires_at INTEGER NOT NULL,
          linked_at INTEGER,
          last_seen_at INTEGER,
          revoked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          user_id TEXT REFERENCES multiplex_user(id) ON DELETE CASCADE
        )`,
        `CREATE UNIQUE INDEX multiplex_console_device_pairing_code_unique
          ON multiplex_console_device (pairing_code)`,
        `CREATE TABLE multiplex_console_pairing_claim_attempt (
          id TEXT PRIMARY KEY NOT NULL,
          attempted_at INTEGER NOT NULL,
          user_id TEXT NOT NULL REFERENCES multiplex_user(id) ON DELETE CASCADE
        )`,
        `INSERT INTO multiplex_user (id) VALUES ('${userId}')`,
      ],
      "write",
    );
  });

  beforeEach(async () => {
    await client.execute("DELETE FROM multiplex_console_device");
    await client.execute("DELETE FROM multiplex_console_pairing_claim_attempt");
  });

  afterAll(async () => {
    client.close();
  });

  test("creates, claims, and authenticates a console without exposing a Plex token", async () => {
    const pairing = await createConsolePairing(
      { platform: "gamecube" },
      {
        database,
        now,
        randomCode: () => "GCN4",
        randomDeviceId: () => deviceId,
        randomDeviceSecret: () => deviceSecret,
      },
    );

    expect(pairing).toEqual({
      deviceId,
      deviceSecret,
      code: "GCN4",
      expiresAt: "2026-07-28T14:05:00.000Z",
      linkPath: "/link",
    });
    expect(
      await pollConsolePairing({ deviceId, deviceSecret }, { database, now }),
    ).toEqual({
      status: "waiting",
      expiresAt: "2026-07-28T14:05:00.000Z",
    });

    const claimedAt = new Date("2026-07-28T14:01:00.000Z");
    expect(
      await claimConsolePairing(userId, "gcn-4", {
        database,
        now: claimedAt,
      }),
    ).toEqual({
      status: "linked",
      device: {
        id: deviceId,
        name: "Nintendo GameCube",
        platform: "gamecube",
      },
    });
    expect(
      await pollConsolePairing(
        { deviceId, deviceSecret },
        { database, now: claimedAt },
      ),
    ).toEqual({
      status: "linked",
      deviceId,
      credentialExpiresAt: "2026-10-26T14:00:00.000Z",
    });
    expect(
      await claimConsolePairing(userId, "GCN4", {
        database,
        now: claimedAt,
      }),
    ).toEqual({ status: "invalid-code" });

    const [storedDevice] = await database.select().from(schema.consoleDevice);
    expect(storedDevice?.pairingCode).toBeNull();
    expect(storedDevice?.credentialHash).toBe(
      hashConsoleCredential(deviceSecret),
    );
    expect(JSON.stringify(storedDevice)).not.toContain(deviceSecret);
  });

  test("rejects the wrong device secret", async () => {
    await createPairing();

    expect(
      await pollConsolePairing(
        {
          deviceId,
          deviceSecret: "wrong-device-secret-with-more-than-32-characters",
        },
        { database, now },
      ),
    ).toEqual({ status: "invalid-credential" });
  });

  test("expires an unclaimed pairing after five minutes", async () => {
    await createPairing();
    const expiredAt = new Date("2026-07-28T14:05:00.000Z");

    expect(
      await pollConsolePairing(
        { deviceId, deviceSecret },
        { database, now: expiredAt },
      ),
    ).toEqual({ status: "expired" });
    expect(
      await claimConsolePairing(userId, "GCN4", {
        database,
        now: expiredAt,
      }),
    ).toEqual({ status: "invalid-code" });
  });

  test("limits authenticated code guessing", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        await claimConsolePairing(userId, "NOPE", { database, now }),
      ).toEqual({ status: "invalid-code" });
    }

    expect(
      await claimConsolePairing(userId, "NOPE", { database, now }),
    ).toEqual({ status: "rate-limited" });
  });
});

test("pairing codes use the unambiguous 32-character alphabet", () => {
  expect(generatePairingCode((maximum) => maximum - 1)).toBe("ZZZZ");
  expect(normalizePairingCode(" gc-n4 ")).toBe("GCN4");
});

async function createPairing(): Promise<void> {
  await createConsolePairing(
    { platform: "gamecube" },
    {
      database,
      now,
      randomCode: () => "GCN4",
      randomDeviceId: () => deviceId,
      randomDeviceSecret: () => deviceSecret,
    },
  );
}

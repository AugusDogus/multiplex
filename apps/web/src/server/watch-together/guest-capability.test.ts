import { describe, expect, test } from "bun:test";

import { createGuestCapabilityCodec } from "./guest-capability";

const INPUT = {
  hostUserId: "host-user-1",
  roomId: "Room123",
  serverId: "server-1",
  ratingKey: "42",
  now: new Date("2026-07-13T12:00:00.000Z"),
  nonce: "c5b59a73-0d9c-4ed0-b01b-c342fcb788cd",
};

describe("guest capability", () => {
  test("round trips a versioned signed payload", async () => {
    const codec = createGuestCapabilityCodec("test-secret");
    const capability = await codec.sign(INPUT);

    const result = await codec.verify(capability, {
      now: new Date("2026-07-13T12:30:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        version: 1,
        hostUserId: INPUT.hostUserId,
        roomId: INPUT.roomId,
        serverId: INPUT.serverId,
        ratingKey: INPUT.ratingKey,
        issuedAt: Math.floor(INPUT.now.getTime() / 1000),
        expiresAt: Math.floor(INPUT.now.getTime() / 1000) + 24 * 60 * 60,
        nonce: INPUT.nonce,
      },
    });
  });

  test("rejects payload tampering", async () => {
    const codec = createGuestCapabilityCodec("test-secret");
    const capability = await codec.sign(INPUT);
    const [payload, signature] = capability.split(".");
    const tampered = `${payload?.slice(0, -1)}A.${signature}`;

    expect(await codec.verify(tampered, { now: INPUT.now })).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });

  test("rejects a capability signed with another key", async () => {
    const capability =
      await createGuestCapabilityCodec("first-secret").sign(INPUT);

    expect(
      await createGuestCapabilityCodec("second-secret").verify(capability, {
        now: INPUT.now,
      }),
    ).toEqual({ ok: false, reason: "invalid-signature" });
  });

  test("rejects expiration and future issuance", async () => {
    const codec = createGuestCapabilityCodec("test-secret");
    const expired = await codec.sign({ ...INPUT, lifetimeSeconds: 60 });
    const future = await codec.sign({
      ...INPUT,
      now: new Date("2026-07-13T13:00:01.000Z"),
    });

    expect(
      await codec.verify(expired, {
        now: new Date("2026-07-13T12:01:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(await codec.verify(future, { now: INPUT.now })).toEqual({
      ok: false,
      reason: "issued-in-future",
    });
  });

  test("rejects malformed input without throwing", async () => {
    const codec = createGuestCapabilityCodec("test-secret");

    expect(await codec.verify("not-a-capability", { now: INPUT.now })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

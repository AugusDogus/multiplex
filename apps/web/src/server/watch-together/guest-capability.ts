import { z } from "zod";

const CAPABILITY_VERSION = 1 as const;
const DEFAULT_LIFETIME_SECONDS = 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 60;
const KEY_CONTEXT = "multiplex/watch-together-guest/v1";

export const guestCapabilityPayloadSchema = z.object({
  version: z.literal(CAPABILITY_VERSION),
  hostUserId: z.string().min(1),
  roomId: z.string().regex(/^[A-Za-z0-9]+$/),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type GuestCapabilityPayload = z.infer<
  typeof guestCapabilityPayloadSchema
>;

export type GuestCapabilityVerification =
  | { readonly ok: true; readonly payload: GuestCapabilityPayload }
  | {
      readonly ok: false;
      readonly reason:
        | "malformed"
        | "invalid-signature"
        | "expired"
        | "issued-in-future";
    };

export interface GuestCapabilityCodec {
  readonly sign: (input: {
    hostUserId: string;
    roomId: string;
    now?: Date;
    lifetimeSeconds?: number;
  }) => Promise<string>;
  readonly verify: (
    capability: string,
    options?: { now?: Date },
  ) => Promise<GuestCapabilityVerification>;
}

export function createGuestCapabilityCodec(
  secret: string,
): GuestCapabilityCodec {
  const keyPromise = deriveSigningKey(secret);

  return {
    async sign(input) {
      const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
      const lifetimeSeconds = input.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
      const payload = guestCapabilityPayloadSchema.parse({
        version: CAPABILITY_VERSION,
        hostUserId: input.hostUserId,
        roomId: input.roomId,
        issuedAt,
        expiresAt: issuedAt + lifetimeSeconds,
      });
      const encodedPayload = encodePayload(payload).toString("base64url");
      const signature = await crypto.subtle.sign(
        "HMAC",
        await keyPromise,
        new TextEncoder().encode(encodedPayload),
      );
      return `${encodedPayload}.${Buffer.from(signature).toString("base64url")}`;
    },

    async verify(capability, options) {
      const segments = capability.split(".");
      const encodedPayload = segments[0];
      const encodedSignature = segments[1];
      if (
        segments.length !== 2 ||
        !encodedPayload ||
        !encodedSignature ||
        !isBase64Url(encodedPayload) ||
        !isBase64Url(encodedSignature)
      ) {
        return { ok: false, reason: "malformed" };
      }

      const signature = Buffer.from(encodedSignature, "base64url");
      const validSignature = await crypto.subtle.verify(
        "HMAC",
        await keyPromise,
        signature,
        new TextEncoder().encode(encodedPayload),
      );
      if (!validSignature) {
        return { ok: false, reason: "invalid-signature" };
      }

      const payload = decodePayload(encodedPayload);
      if (!payload) {
        return { ok: false, reason: "malformed" };
      }

      const nowSeconds = Math.floor(
        (options?.now ?? new Date()).getTime() / 1000,
      );
      if (payload.issuedAt > nowSeconds + FUTURE_CLOCK_SKEW_SECONDS) {
        return { ok: false, reason: "issued-in-future" };
      }
      if (payload.expiresAt <= nowSeconds) {
        return { ok: false, reason: "expired" };
      }

      return { ok: true, payload };
    },
  };
}

async function deriveSigningKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(KEY_CONTEXT),
      info: encoder.encode("capability-signing"),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** Boundary adapter: compact binary and base64 are decoded once, then Zod owns shape. */
function decodePayload(encodedPayload: string): GuestCapabilityPayload | null {
  try {
    const bytes = Buffer.from(encodedPayload, "base64url");
    if (bytes.length < 11) return null;
    const hostLength = bytes.readUInt8(9);
    const roomLength = bytes.readUInt8(10);
    if (bytes.length !== 11 + hostLength + roomLength) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const value = {
      version: bytes.readUInt8(0),
      issuedAt: bytes.readUInt32BE(1),
      expiresAt: bytes.readUInt32BE(5),
      hostUserId: decoder.decode(bytes.subarray(11, 11 + hostLength)),
      roomId: decoder.decode(bytes.subarray(11 + hostLength)),
    };
    const parsed = guestCapabilityPayloadSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function encodePayload(payload: GuestCapabilityPayload): Buffer {
  const host = Buffer.from(payload.hostUserId, "utf8");
  const room = Buffer.from(payload.roomId, "utf8");
  if (host.length > 255 || room.length > 255) {
    throw new RangeError("Guest capability identifiers are too long");
  }
  const bytes = Buffer.alloc(11 + host.length + room.length);
  bytes.writeUInt8(payload.version, 0);
  bytes.writeUInt32BE(payload.issuedAt, 1);
  bytes.writeUInt32BE(payload.expiresAt, 5);
  bytes.writeUInt8(host.length, 9);
  bytes.writeUInt8(room.length, 10);
  host.copy(bytes, 11);
  room.copy(bytes, 11 + host.length);
  return bytes;
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

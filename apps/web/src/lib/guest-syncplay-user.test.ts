import { describe, expect, test } from "bun:test";
import { decodeSyncplayUser, encodeSyncplayUser } from "@multiplex/plex-query";

import {
  createGuestDeviceIdentifier,
  createGuestSyncplayUser,
} from "./guest-syncplay-user";

describe("createGuestSyncplayUser", () => {
  test("keeps the encoded guest identity below Plex Syncplay's truncation limit", () => {
    const deviceIdentifier = createGuestDeviceIdentifier(
      () => "12345678-1234-1234-1234-123456789abc",
    );
    const user = createGuestSyncplayUser({
      guestUserId: 1234567890,
      nickname: "🎥".repeat(40),
      deviceIdentifier,
    });
    const encoded = encodeSyncplayUser(user);

    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      140,
    );
    expect(decodeSyncplayUser(encoded)).toEqual(user);
    expect(user.deviceIdentifier).toBe("multiplex-guest-123456781234");
  });

  test("preserves an ordinary display name", () => {
    const user = createGuestSyncplayUser({
      guestUserId: 20,
      nickname: "Alex",
      deviceIdentifier: "multiplex-guest-123456781234",
    });

    expect(user.deviceName).toBe("Multiplex Guest · Alex");
  });
});

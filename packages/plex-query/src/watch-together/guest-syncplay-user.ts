import { encodeSyncplayUser, type SyncplayUser } from "../plex/clients/syncplay-client";

const SYNCPLAY_USERNAME_BYTE_BUDGET = 140;
const GUEST_DEVICE_NAME_PREFIX = "Multiplex Guest · ";

interface GuestSyncplayUserInput {
  readonly guestUserId: number;
  readonly nickname: string;
  readonly deviceIdentifier: string;
}

export function createGuestSyncplayUser({
  guestUserId,
  nickname,
  deviceIdentifier,
}: GuestSyncplayUserInput): SyncplayUser {
  const baseUser: SyncplayUser = {
    id: guestUserId,
    deviceIdentifier,
    deviceName: GUEST_DEVICE_NAME_PREFIX,
  };
  let visibleNickname = "";

  for (const character of nickname.trim()) {
    const candidate = {
      ...baseUser,
      deviceName: `${GUEST_DEVICE_NAME_PREFIX}${visibleNickname}${character}`,
    };
    if (utf8ByteLength(encodeSyncplayUser(candidate)) > SYNCPLAY_USERNAME_BYTE_BUDGET) {
      break;
    }
    visibleNickname += character;
  }

  return {
    ...baseUser,
    deviceName: `${GUEST_DEVICE_NAME_PREFIX}${visibleNickname || "Guest"}`,
  };
}

export function createGuestDeviceIdentifier(randomUUID: () => string): string {
  return `multiplex-guest-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function getWatchTogetherRoomHref(roomId: string): string {
  return `/watch-together/${roomId}`;
}

const GUEST_HOST_CAPABILITY_PREFIX = "multiplex:guest-host-capability:";

export function storeGuestHostCapability(
  roomId: string,
  capability: string,
): void {
  try {
    sessionStorage.setItem(
      `${GUEST_HOST_CAPABILITY_PREFIX}${roomId}`,
      capability,
    );
  } catch {
    // The signed query fallback still works when tab storage is unavailable.
  }
}

export function readGuestHostCapability(roomId: string): string | null {
  try {
    return sessionStorage.getItem(`${GUEST_HOST_CAPABILITY_PREFIX}${roomId}`);
  } catch {
    return null;
  }
}

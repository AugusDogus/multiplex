import { createGuestDeviceIdentifier as createSharedGuestDeviceIdentifier } from "@multiplex/plex-query";

export { createGuestSyncplayUser } from "@multiplex/plex-query";

export function createGuestDeviceIdentifier(
  randomUUID: () => string = () => crypto.randomUUID(),
): string {
  return createSharedGuestDeviceIdentifier(randomUUID);
}

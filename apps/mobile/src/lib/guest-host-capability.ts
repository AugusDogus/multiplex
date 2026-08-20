import * as SecureStore from "expo-secure-store";

const KEY_PREFIX = "multiplex.guest-host-capability.";

export function storeGuestHostCapability(roomId: string, capability: string): Promise<void> {
  return SecureStore.setItemAsync(`${KEY_PREFIX}${roomId}`, capability);
}

export function readGuestHostCapability(roomId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${KEY_PREFIX}${roomId}`);
}

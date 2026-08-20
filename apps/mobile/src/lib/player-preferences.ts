import * as SecureStore from "expo-secure-store";

const AUTO_PLAY_KEY = "multiplex.player.auto-play";

export async function readAutoPlayEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(AUTO_PLAY_KEY)) !== "false";
}

export function storeAutoPlayEnabled(enabled: boolean): Promise<void> {
  return SecureStore.setItemAsync(AUTO_PLAY_KEY, String(enabled));
}

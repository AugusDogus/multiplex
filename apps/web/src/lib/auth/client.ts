import { createAuthClient } from "better-auth/react";
import { plex } from "@multiplex/auth-plugin-plex/client";

import { clearAuthHintCookie } from "~/lib/auth/clear-auth-hint";
import { clearSyncEngineSession } from "~/lib/sync-engine/clear-session";

export const authClient = createAuthClient({
  plugins: [plex()],
});

/**
 * Sign out and drop session-scoped sync state (connection overlay + OPFS replica)
 * so the next account in this tab cannot reuse credentials or cached rows.
 *
 * Do not use `authClient.signOut.bind(...)` — better-auth's client is a path
 * proxy, so `.bind` is treated as another route segment and fires a bogus fetch.
 */
export async function signOut(
  ...args: Parameters<typeof authClient.signOut>
): Promise<ReturnType<typeof authClient.signOut>> {
  clearAuthHintCookie();
  await clearSyncEngineSession().catch(() => undefined);
  return authClient.signOut(...args);
}

import { createAuthClient } from "better-auth/react";
import { plex } from "@multiplex/auth-plugin-plex/client";

import { clearAuthHintCookie } from "~/lib/auth/clear-auth-hint";
import { clearSyncEngineSession } from "~/lib/sync-engine/clear-session";

export const authClient = createAuthClient({
  plugins: [plex()],
});

const authSignOut = authClient.signOut.bind(authClient);

/**
 * Sign out and drop session-scoped sync state (connection overlay + OPFS replica)
 * so the next account in this tab cannot reuse credentials or cached rows.
 */
export async function signOut(
  ...args: Parameters<typeof authSignOut>
): Promise<ReturnType<typeof authSignOut>> {
  clearAuthHintCookie();
  await clearSyncEngineSession().catch(() => undefined);
  return authSignOut(...args);
}

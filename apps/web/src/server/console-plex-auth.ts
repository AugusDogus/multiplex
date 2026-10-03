import { auth } from "~/lib/auth/server";
import {
  authenticateConsoleDevice,
  parseConsoleDeviceAuthorization,
} from "~/server/console-pairing";

export type ConsolePlexAuthorization =
  | { kind: "unauthorized" }
  | { kind: "plex-not-linked" }
  | { kind: "ready"; plexAuthToken: string };

export async function authorizeConsolePlexRequest(
  request: Request,
): Promise<ConsolePlexAuthorization> {
  const deviceCredential = parseConsoleDeviceAuthorization(
    request.headers.get("authorization"),
  );
  if (deviceCredential) {
    const authenticated = await authenticateConsoleDevice(deviceCredential);
    if (!authenticated) return { kind: "unauthorized" };
    return authenticated.user.plexAuthToken
      ? { kind: "ready", plexAuthToken: authenticated.user.plexAuthToken }
      : { kind: "plex-not-linked" };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { kind: "unauthorized" };
  return session.user.plexAuthToken
    ? { kind: "ready", plexAuthToken: session.user.plexAuthToken }
    : { kind: "plex-not-linked" };
}

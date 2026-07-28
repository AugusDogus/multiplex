import {
  authenticateConsoleDevice,
  parseConsoleDeviceAuthorization,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function GET(request: Request): Promise<Response> {
  const credential = parseConsoleDeviceAuthorization(
    request.headers.get("authorization"),
  );
  if (!credential) {
    return unauthorized();
  }
  const authenticated = await authenticateConsoleDevice(credential);
  if (!authenticated) {
    return unauthorized();
  }

  return Response.json(
    {
      apiVersion: 1,
      status: "ready",
      device: {
        ...authenticated.device,
        credentialExpiresAt:
          authenticated.device.credentialExpiresAt.toISOString(),
      },
      account: {
        plexLinked: Boolean(authenticated.user.plexAuthToken),
      },
    },
    { headers: RESPONSE_HEADERS },
  );
}

function unauthorized(): Response {
  return Response.json(
    { status: "invalid-credential" },
    {
      status: 401,
      headers: {
        ...RESPONSE_HEADERS,
        "WWW-Authenticate": 'MultiplexDevice realm="Multiplex Console"',
      },
    },
  );
}

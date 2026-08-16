import { auth } from "~/lib/auth/server";
import {
  claimConsolePairing,
  claimConsolePairingSchema,
  parseConsolePairingRequest,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.plexAuthToken) {
    return Response.json(
      { status: "unauthorized" },
      { status: 401, headers: RESPONSE_HEADERS },
    );
  }

  const input = await parseConsolePairingRequest(
    request,
    claimConsolePairingSchema,
  );
  if (!input) {
    return Response.json(
      { status: "invalid-request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const result = await claimConsolePairing(session.user.id, input.code);
  return Response.json(result, {
    status:
      result.status === "linked"
        ? 200
        : result.status === "rate-limited"
          ? 429
          : 404,
    headers: RESPONSE_HEADERS,
  });
}

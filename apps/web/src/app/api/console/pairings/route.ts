import {
  createConsolePairing,
  createConsolePairingSchema,
  parseConsolePairingRequest,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request): Promise<Response> {
  const input = await parseConsolePairingRequest(
    request,
    createConsolePairingSchema,
  );
  if (!input) {
    return Response.json(
      { status: "invalid-request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const pairing = await createConsolePairing(input);
  return Response.json(pairing, {
    status: 201,
    headers: RESPONSE_HEADERS,
  });
}

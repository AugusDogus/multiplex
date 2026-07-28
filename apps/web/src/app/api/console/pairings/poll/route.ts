import {
  pollConsolePairing,
  pollConsolePairingSchema,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request): Promise<Response> {
  const parsed = pollConsolePairingSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return Response.json(
      { status: "invalid-request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const result = await pollConsolePairing(parsed.data);
  const status =
    result.status === "invalid-credential"
      ? 401
      : result.status === "expired"
        ? 410
        : 200;
  return Response.json(result, { status, headers: RESPONSE_HEADERS });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

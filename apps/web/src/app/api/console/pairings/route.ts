import {
  createConsolePairing,
  createConsolePairingSchema,
} from "~/server/console-pairing";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request): Promise<Response> {
  const parsed = createConsolePairingSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return Response.json(
      { status: "invalid-request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const pairing = await createConsolePairing(parsed.data);
  return Response.json(pairing, {
    status: 201,
    headers: RESPONSE_HEADERS,
  });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

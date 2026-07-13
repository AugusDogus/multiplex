import { z } from "zod";

import { continueGuestInvite } from "~/server/watch-together/guest-bootstrap";

const requestSchema = z.object({
  capability: z.string().min(1).max(4_096),
  nextRatingKey: z.string().regex(/^\d+$/),
});

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest();
  }

  const result = await continueGuestInvite(
    parsed.data.capability,
    parsed.data.nextRatingKey,
  );
  return Response.json(result, {
    status:
      !result.ok && result.reason === "invalid-invite"
        ? 400
        : !result.ok && result.reason === "expired-invite"
          ? 410
          : 200,
    headers: RESPONSE_HEADERS,
  });
}

function invalidRequest(): Response {
  return Response.json(
    { ok: false, reason: "invalid-invite" },
    { status: 400, headers: RESPONSE_HEADERS },
  );
}

import { z } from "zod";

import { bootstrapGuestInvite } from "~/server/watch-together/guest-bootstrap";

const requestSchema = z.object({
  capability: z.string().min(1).max(4_096),
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
    return Response.json(
      { ok: false, reason: "invalid-invite" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, reason: "invalid-invite" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const result = await bootstrapGuestInvite(parsed.data.capability);
  if (!result.ok) {
    const status =
      result.reason === "invalid-invite"
        ? 400
        : result.reason === "expired-invite"
          ? 410
          : 404;
    return Response.json(result, { status, headers: RESPONSE_HEADERS });
  }

  return Response.json(result, { headers: RESPONSE_HEADERS });
}

import { z } from "zod";

/**
 * Same-origin relative path validation for post-auth redirects.
 *
 * Anything that is not a safe in-app path collapses to `/` — including
 * protocol-relative URLs (`//evil.com`), absolute URLs, and API routes.
 * Decoding must be total: junk never throws.
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  // Block auth/API surfaces so a forged returnTo cannot bounce into token flows.
  if (
    value === "/api" ||
    value.startsWith("/api/") ||
    value.startsWith("/api?") ||
    value.startsWith("/api#") ||
    value === "/login" ||
    value.startsWith("/login?") ||
    value.startsWith("/login#")
  ) {
    return "/";
  }

  return value;
}

const oauthStatePayloadSchema = z.object({
  nonce: z.string().min(1),
  returnTo: z.string().optional(),
});

/** Encode OAuth `state` as base64url(JSON { nonce, returnTo }). */
export function encodeOAuthState(input: { nonce: string; returnTo: string }): string {
  const returnTo = sanitizeReturnTo(input.returnTo);
  const payload = returnTo === "/" ? { nonce: input.nonce } : { nonce: input.nonce, returnTo };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decode OAuth `state`. Providers may echo junk we never minted — returns
 * null instead of throwing. `returnTo` is always sanitized.
 */
export function decodeOAuthState(
  state: string | null | undefined,
): { nonce: string; returnTo: string } | null {
  if (!state) {
    return null;
  }

  try {
    const json = Buffer.from(state, "base64url").toString("utf8");
    const parsed = oauthStatePayloadSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      return null;
    }

    return {
      nonce: parsed.data.nonce,
      returnTo: sanitizeReturnTo(parsed.data.returnTo),
    };
  } catch {
    return null;
  }
}

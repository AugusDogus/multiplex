/**
 * Same-origin relative path validation for post-auth redirects.
 *
 * Anything that is not a safe in-app path collapses to `/` — including
 * protocol-relative URLs (`//evil.com`), absolute URLs, and API routes.
 * Decoding must be total: junk never throws.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  // Block auth/API surfaces so a forged returnTo cannot bounce into token flows.
  if (
    value === "/api" ||
    value.startsWith("/api/") ||
    value === "/login" ||
    value.startsWith("/login?") ||
    value.startsWith("/login#")
  ) {
    return "/";
  }

  return value;
}

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
export function decodeOAuthState(state: unknown): { nonce: string; returnTo: string } | null {
  if (typeof state !== "string" || state.length === 0) {
    return null;
  }

  try {
    const json = Buffer.from(state, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("nonce" in parsed) ||
      typeof (parsed as { nonce: unknown }).nonce !== "string" ||
      (parsed as { nonce: string }).nonce.length === 0
    ) {
      return null;
    }

    const returnTo =
      "returnTo" in parsed ? sanitizeReturnTo((parsed as { returnTo: unknown }).returnTo) : "/";

    return {
      nonce: (parsed as { nonce: string }).nonce,
      returnTo,
    };
  } catch {
    return null;
  }
}

import { z } from "zod";

import { base64UrlToUtf8, utf8ToBase64Url } from "~/lib/auth/base64url";

/** Non-HttpOnly hint for optimistic identity paint. Never an authority. */
export const AUTH_HINT_COOKIE = "multiplex.auth_hint";

const authHintSchema = z.object({
  v: z.literal(1),
  name: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  image: z.string().max(2_000).optional(),
});

export type AuthHint = z.infer<typeof authHintSchema>;

export function serializeAuthHint(hint: Omit<AuthHint, "v">): string {
  const payload: AuthHint = {
    v: 1,
    name: hint.name,
    ...(hint.email ? { email: hint.email } : {}),
    ...(hint.image ? { image: hint.image } : {}),
  };

  return utf8ToBase64Url(JSON.stringify(payload));
}

/** Schema-validate on read; malformed → absent. */
export function parseAuthHint(value: unknown): AuthHint | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const parsed = authHintSchema.safeParse(JSON.parse(base64UrlToUtf8(value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function authHintFromUser(user: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}): AuthHint | null {
  if (!user.name) {
    return null;
  }

  return {
    v: 1,
    name: user.name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.image ? { image: user.image } : {}),
  };
}

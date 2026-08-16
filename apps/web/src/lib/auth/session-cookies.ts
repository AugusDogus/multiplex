import type { NextResponse } from "next/server";

import { AUTH_HINT_COOKIE } from "~/lib/auth/auth-hint";

const SESSION_COOKIE_BASE_NAMES = [
  "better-auth.session_token",
  "better-auth.session_data",
  "better-auth.dont_remember",
] as const;

function expireCookie(
  response: NextResponse,
  name: string,
  options?: { secure?: boolean },
): void {
  response.cookies.set(name, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    httpOnly: name !== AUTH_HINT_COOKIE,
    secure: options?.secure ?? false,
  });
}

/**
 * Clear Better Auth session carriers + the optimistic auth hint.
 * Invalid carriers are worse than none — anything keyed on presence misbehaves
 * until they are gone.
 */
export function clearAuthCookies(
  response: NextResponse,
  requestCookies?: { getAll(): { name: string }[] },
): void {
  const names = new Set<string>([
    ...SESSION_COOKIE_BASE_NAMES,
    ...SESSION_COOKIE_BASE_NAMES.map((name) => `__Secure-${name}`),
    AUTH_HINT_COOKIE,
  ]);

  if (requestCookies) {
    for (const { name } of requestCookies.getAll()) {
      if (
        name.startsWith("better-auth.session_data.") ||
        name.startsWith("__Secure-better-auth.session_data.")
      ) {
        names.add(name);
      }
    }
  }

  for (const name of names) {
    expireCookie(response, name, { secure: name.startsWith("__Secure-") });
  }
}

/** Copy Set-Cookie headers from a Better Auth getSession call onto a response. */
export function applySetCookieHeaders(
  response: NextResponse,
  headers: Headers | null | undefined,
): void {
  if (!headers) return;

  const getSetCookie = headers.getSetCookie;

  const cookies = getSetCookie
    ? getSetCookie.call(headers)
    : splitSetCookie(headers.get("set-cookie"));

  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
}

function splitSetCookie(header: string | null): string[] {
  if (!header) return [];
  // Fallback for runtimes without getSetCookie — coarse but better than drop.
  return header.split(/,(?=\s*[^;=]+=)/).map((part) => part.trim());
}

export function setAuthHintCookie(
  response: NextResponse,
  value: string,
  options?: { secure?: boolean },
): void {
  response.cookies.set(AUTH_HINT_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: false,
    secure: options?.secure ?? false,
  });
}

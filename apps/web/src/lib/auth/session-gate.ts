import { sanitizeReturnTo } from "@multiplex/auth-plugin-plex/return-to";
import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authHintFromUser, serializeAuthHint } from "~/lib/auth/auth-hint";
import { isDocumentNavigation } from "~/lib/auth/document-request";
import {
  clearAuthCookies,
  setAuthHintCookie,
} from "~/lib/auth/session-cookies";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/watch-together/guest/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg"
  );
}

function buildLoginRedirect(request: NextRequest): URL {
  const loginUrl = new URL("/login", request.url);
  const returnTo = sanitizeReturnTo(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (returnTo !== "/") {
    loginUrl.searchParams.set("returnTo", returnTo);
  }
  return loginUrl;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(buildLoginRedirect(request), 302);
  clearAuthCookies(response, request.cookies);
  return response;
}

function withAuthHint(
  response: NextResponse,
  user: { name?: string | null; email?: string | null; image?: string | null },
  request: NextRequest,
): NextResponse {
  const hint = authHintFromUser(user);
  if (!hint) return response;

  setAuthHintCookie(response, serializeAuthHint(hint), {
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}

const sessionProbeSchema = z
  .object({
    session: z.object({ token: z.string().optional() }).nullable(),
    user: z
      .object({
        name: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        image: z.string().nullable().optional(),
      })
      .nullable(),
  })
  .nullable();

type SessionProbe = z.infer<typeof sessionProbeSchema>;

/**
 * Validate via Better Auth's HTTP get-session without importing the DB-backed
 * auth server into the proxy bundle. Forwards Set-Cookie (cache refresh /
 * clears) onto the gate response.
 */
async function probeSession(
  request: NextRequest,
): Promise<{ session: SessionProbe; setCookieHeaders: string[] }> {
  const url = new URL("/api/auth/get-session", request.nextUrl.origin);
  const headers = new Headers({
    accept: "application/json",
    cookie: request.headers.get("cookie") ?? "",
  });

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const setCookieHeaders =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];

  if (!response.ok) {
    return { session: null, setCookieHeaders };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { session: null, setCookieHeaders };
  }

  const parsed = sessionProbeSchema.safeParse(raw);
  if (!parsed.success || !parsed.data?.session || !parsed.data.user) {
    return { session: null, setCookieHeaders };
  }

  return { session: parsed.data, setCookieHeaders };
}

/**
 * Document-navigation session gate.
 *
 * 1. Verify the signed cookie cache locally when present (no DB).
 * 2. If only a session token remains, probe `/api/auth/get-session` and
 *    persist any rotation / cache refresh Set-Cookie headers.
 * 3. On failure, clear carriers + hint and 302 to `/login?returnTo=…`.
 * Failures collapse to signed-out; never 500.
 */
export async function gateDocumentSession(
  request: NextRequest,
): Promise<NextResponse> {
  if (
    !isDocumentNavigation(request) ||
    isPublicPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  try {
    const secret = process.env.BETTER_AUTH_SECRET;
    const sessionToken = getSessionCookie(request);

    if (!sessionToken) {
      return redirectToLogin(request);
    }

    if (secret) {
      const cached = await getCookieCache(request, { secret });
      if (cached?.session && cached.user) {
        return withAuthHint(NextResponse.next(), cached.user, request);
      }
    }

    const { session, setCookieHeaders } = await probeSession(request);
    if (!session?.user) {
      const response = redirectToLogin(request);
      for (const cookie of setCookieHeaders) {
        response.headers.append("set-cookie", cookie);
      }
      return response;
    }

    const response = NextResponse.next();
    for (const cookie of setCookieHeaders) {
      response.headers.append("set-cookie", cookie);
    }
    return withAuthHint(response, session.user, request);
  } catch {
    return redirectToLogin(request);
  }
}

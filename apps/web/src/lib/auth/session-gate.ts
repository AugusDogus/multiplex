import { sanitizeReturnTo } from "@multiplex/auth-plugin-plex/return-to";
import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { authHintFromUser, serializeAuthHint } from "~/lib/auth/auth-hint";
import { isDocumentNavigation } from "~/lib/auth/document-request";
import {
  applySetCookieHeaders,
  clearAuthCookies,
  setAuthHintCookie,
} from "~/lib/auth/session-cookies";
import { auth } from "~/lib/auth/server";

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

/**
 * Document-navigation session gate.
 *
 * 1. Verify the signed cookie cache locally when present (no DB).
 * 2. If only a session token remains, ask Better Auth — persist any rotation /
 *    cache refresh Set-Cookie headers on the allow response.
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

    const result = await auth.api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });

    const session = result.response;
    if (!session) {
      const response = redirectToLogin(request);
      applySetCookieHeaders(response, result.headers);
      return response;
    }

    const response = NextResponse.next();
    applySetCookieHeaders(response, result.headers);
    return withAuthHint(response, session.user, request);
  } catch {
    return redirectToLogin(request);
  }
}

"use client";

import { useEffect } from "react";

import { AUTH_HINT_COOKIE, serializeAuthHint } from "~/lib/auth/auth-hint";
import {
  clearAuthHintCookie,
  readAuthHintCookieRaw,
} from "~/lib/auth/clear-auth-hint";

/** Keep the hint aligned with the authoritative session probe. */
export function useReconcileAuthHint(
  sessionUser:
    | {
        name?: string | null;
        email?: string | null;
        image?: string | null;
      }
    | null
    | undefined,
): void {
  useEffect(() => {
    if (sessionUser === undefined) {
      return;
    }

    if (!sessionUser?.name) {
      clearAuthHintCookie();
      return;
    }

    const next = serializeAuthHint({
      name: sessionUser.name,
      email: sessionUser.email ?? undefined,
      image: sessionUser.image ?? undefined,
    });
    const current = readAuthHintCookieRaw();
    if (current === next) {
      return;
    }

    const secure = globalThis.window?.location.protocol === "https:";
    document.cookie = `${AUTH_HINT_COOKIE}=${next}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure ? "; Secure" : ""}`;
  }, [sessionUser]);
}

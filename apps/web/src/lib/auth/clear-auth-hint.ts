import { AUTH_HINT_COOKIE } from "~/lib/auth/auth-hint";

/** Client-side clear when a probe contradicts the hint or on sign-out. */
export function clearAuthHintCookie(): void {
  if (typeof document === "undefined") return;

  document.cookie = `${AUTH_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readAuthHintCookieRaw(): string | null {
  if (typeof document === "undefined") return null;

  const prefix = `${AUTH_HINT_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

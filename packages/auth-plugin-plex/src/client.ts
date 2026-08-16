import type { BetterAuthClientPlugin } from "better-auth/types";
import type { plex as serverPlugin } from "./server";

function resolveReturnTo(returnTo?: string): string | undefined {
  if (returnTo) {
    return returnTo;
  }

  if (!globalThis.window) {
    return undefined;
  }

  try {
    return new URLSearchParams(globalThis.window.location.search).get("returnTo") ?? undefined;
  } catch {
    return undefined;
  }
}

export const plex = () => {
  return {
    id: "plex-auth",
    // SAFETY: Better Auth uses this empty value only as a compile-time carrier
    // for the matching server plugin type and never reads it at runtime.
    $InferServerPlugin: {} as ReturnType<typeof serverPlugin>,
    getActions: () => ({
      plex: {
        signIn: async (options?: { returnTo?: string }) => {
          const returnTo = resolveReturnTo(options?.returnTo);
          const url = new URL("/api/auth/plex/auth/initiate", globalThis.window.location.origin);
          if (returnTo) {
            url.searchParams.set("returnTo", returnTo);
          }
          globalThis.window.location.href = `${url.pathname}${url.search}`;
        },
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

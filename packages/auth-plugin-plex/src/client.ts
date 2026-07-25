import type { BetterAuthClientPlugin } from "better-auth/types";
import type { plex as serverPlugin } from "./server";

function resolveReturnTo(returnTo?: string): string | undefined {
  if (typeof returnTo === "string" && returnTo.length > 0) {
    return returnTo;
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return new URLSearchParams(window.location.search).get("returnTo") ?? undefined;
  } catch {
    return undefined;
  }
}

export const plex = () => {
  return {
    id: "plex-auth",
    $InferServerPlugin: {} as ReturnType<typeof serverPlugin>,
    getActions: () => ({
      plex: {
        signIn: async (options?: { returnTo?: string }) => {
          const returnTo = resolveReturnTo(options?.returnTo);
          const url = new URL("/api/auth/plex/auth/initiate", window.location.origin);
          if (returnTo) {
            url.searchParams.set("returnTo", returnTo);
          }
          window.location.href = `${url.pathname}${url.search}`;
        },
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

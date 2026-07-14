import type { BetterAuthClientPlugin } from "better-auth/types";
import type { plex as serverPlugin } from "./server";

export const plex = () => {
  return {
    id: "plex-auth",
    $InferServerPlugin: {} as ReturnType<typeof serverPlugin>,
    getActions: () => ({
      plex: {
        signIn: async () => {
          // Redirect to the server endpoint which will handle the Plex OAuth flow
          window.location.href = "/api/auth/plex/auth/initiate";
        },
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

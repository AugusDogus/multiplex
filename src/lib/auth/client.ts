import { createAuthClient } from "better-auth/react";
import { plex } from "~/plugins/plex/client";

export const authClient = createAuthClient({
  plugins: [plex()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

import { createAuthClient } from "better-auth/react";
import { plex } from "@multiplex/auth-plugin-plex/client";

export const authClient = createAuthClient({
  plugins: [plex()],
});

export const { signOut } = authClient;

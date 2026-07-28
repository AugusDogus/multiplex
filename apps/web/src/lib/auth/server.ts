import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, openAPI } from "better-auth/plugins";
import { plex } from "@multiplex/auth-plugin-plex/server";
import { db } from "~/server/db"; // your drizzle instance

const NATIVE_CLIENT_IDS = new Set([
  "multiplex-gamecube",
  "multiplex-wii",
  "multiplex-dreamcast",
  "multiplex-xbox",
  "multiplex-ps2",
]);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),
  rateLimit: {
    enabled: true,
    storage: "memory",
    customRules: {
      "/device": { window: 60, max: 10 },
      "/device/approve": { window: 60, max: 10 },
      "/device/code": { window: 60, max: 10 },
      // A client polling at the advertised five-second interval makes twelve
      // requests per minute. Leave room for retry jitter without allowing a
      // device to hammer the token endpoint.
      "/device/token": { window: 60, max: 20 },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // Cache for 5 minutes
    },
  },
  plugins: [
    plex(),
    deviceAuthorization({
      expiresIn: "30m",
      interval: "5s",
      userCodeLength: 4,
      verificationUri: "/link",
      validateClient: (clientId) => NATIVE_CLIENT_IDS.has(clientId),
      // Better Auth 1.6.13's runtime schema accidentally requires this
      // optional override. An empty object keeps the plugin defaults.
      schema: {},
    }),
    bearer(),
    openAPI(),
  ],
});

import { z } from "zod";

// Plex.tv API Schemas
export const deviceSchema = z.object({
  name: z.string(),
  product: z.string(),
  productVersion: z.string(),
  platform: z.string(),
  platformVersion: z.string(),
  device: z.string(),
  clientIdentifier: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  provides: z.string(),
  ownerId: z.number().nullable(),
  sourceTitle: z.string().nullable(),
  publicAddress: z.string(),
  accessToken: z.string().nullable(),
  owned: z.boolean(),
  home: z.boolean(),
  synced: z.boolean(),
  relay: z.boolean(),
  presence: z.boolean(),
  httpsRequired: z.boolean(),
  publicAddressMatches: z.boolean(),
  dnsRebindingProtection: z.boolean().nullish(),
  natLoopbackSupported: z.boolean().nullish(),
  connections: z.array(
    z.object({
      protocol: z.string(),
      address: z.string(),
      port: z.number(),
      uri: z.string(),
      local: z.boolean(),
      relay: z.boolean(),
      IPv6: z.boolean(),
    }),
  ),
});

export const authCallbackSchema = z.object({
  id: z.preprocess((value) => parseInt(z.string().parse(value)), z.number()),
  code: z.string(),
});

export const sessionsSchema = z.array(deviceSchema);

// Type exports
export type PlexDevice = z.infer<typeof deviceSchema>;
export type PlexAuthCallback = z.infer<typeof authCallbackSchema>;

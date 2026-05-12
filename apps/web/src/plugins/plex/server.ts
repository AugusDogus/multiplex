import type { AuthPluginSchema, BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { mergeSchema } from "better-auth/db";
import type { User } from "better-auth/types";
import { APIError } from "better-call";
import { z } from "zod";

// Plex auth schemas
const authSchema = z.object({
  id: z.number(),
  code: z.string(),
  product: z.string(),
  trusted: z.boolean(),
  qr: z.string(),
  clientIdentifier: z.string(),
  location: z.object({
    code: z.string(),
    european_union_member: z.boolean(),
    continent_code: z.string(),
    country: z.string(),
    city: z.string(),
    time_zone: z.string(),
    postal_code: z.string(),
    in_privacy_restricted_country: z.boolean(),
    subdivisions: z.string(),
    coordinates: z.string(),
  }),
  expiresIn: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  authToken: z.string().nullable(),
  newRegistration: z.boolean().nullable(),
});

const authCallbackSchema = z.object({
  id: z.preprocess((value) => parseInt(z.string().parse(value)), z.number()),
  code: z.string(),
});

const deviceSchema = z.object({
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

const sessionsSchema = z.array(deviceSchema);

const userInfoSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    username: z.string(),
    title: z.string(),
    email: z.string(),
    friendlyName: z.string(),
    locale: z.string().nullable(),
    confirmed: z.boolean(),
    joinedAt: z.number(),
    emailOnlyAuth: z.boolean(),
    hasPassword: z.boolean(),
    protected: z.boolean(),
    thumb: z.string(),
    authToken: z.string().nullable(),
    mailingListStatus: z.string().optional(),
    mailingListActive: z.boolean().optional(),
    scrobbleTypes: z.string().optional(),
    country: z.string().optional(),
    subscription: z
      .object({
        active: z.boolean(),
        subscribedAt: z.string().nullable(),
        status: z.string(),
        paymentService: z.string().nullable(),
        plan: z.string().nullable(),
        features: z.array(z.string()),
      })
      .nullable(),
    subscriptionDescription: z.string().nullable(),
    restricted: z.boolean(),
    anonymous: z.boolean(),
    home: z.boolean(),
    guest: z.boolean(),
    homeSize: z.number(),
    homeAdmin: z.boolean(),
    maxHomeSize: z.number(),
    certificateVersion: z.number().optional(),
    rememberExpiresAt: z.number(),
    profile: z.object({
      autoSelectAudio: z.boolean(),
      autoSelectSubtitle: z.number(),
      defaultAudioLanguage: z.string().nullable(),
      defaultSubtitleLanguage: z.string().nullable(),
      autoSelectSubtitleMode: z.number().optional(),
      defaultSubtitleAccessibility: z.number(),
      defaultSubtitleForced: z.number(),
    }),
    entitlements: z.array(z.string()).optional().default([]),
    roles: z.array(z.string()).optional().default([]),
    services: z
      .array(
        z.object({
          identifier: z.string(),
          endpoint: z.string(),
          token: z.string().nullable(),
          secret: z.string().nullable(),
          status: z.string(),
        }),
      )
      .optional()
      .default([]),
    adsConsent: z.boolean().nullable(),
    adsConsentSetAt: z.number().nullable(),
    adsConsentReminderAt: z.number().nullable(),
    experimentalFeatures: z.boolean().optional(),
    twoFactorEnabled: z.boolean().optional(),
    backupCodesCreated: z.boolean().optional(),
  })
  .passthrough();

export interface UserWithPlex extends User {
  plexId?: number;
  plexUuid?: string;
  plexUsername?: string;
  plexAuthToken?: string;
}

// Plex configuration
const config = {
  product: "Multiplex",
  clientIdentifier: "multiplex-app",
};

// Utility functions
const getAuth = async () => {
  const url = new URL("https://plex.tv/api/v2/pins");
  url.searchParams.append("strong", "true");
  url.searchParams.append("X-Plex-Product", config.product);
  url.searchParams.append("X-Plex-Client-Identifier", config.clientIdentifier);

  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to create Plex PIN: ${response.statusText}`);
  }

  const auth = await authSchema.parseAsync(await response.json());
  return auth;
};

const getUrl = (auth: z.infer<typeof authSchema>, callbackUrl: string) => {
  const url = new URL("https://app.plex.tv/auth");
  const forwardUrl = new URL(callbackUrl);

  forwardUrl.searchParams.set("code", auth.code);
  forwardUrl.searchParams.set("id", String(auth.id));

  url.searchParams.set("forwardUrl", forwardUrl.toString());
  url.searchParams.set("clientID", config.clientIdentifier);
  url.searchParams.set("code", auth.code);
  url.searchParams.set("context[device][product]", config.product);

  return url.href.replace("auth", "auth#!").toString();
};

const isValid = async (
  auth: Pick<z.infer<typeof authSchema>, "id" | "code">,
) => {
  const url = new URL(`https://plex.tv/api/v2/pins/${auth.id}`);
  url.searchParams.append("code", auth.code);
  url.searchParams.append("X-Plex-Client-Identifier", config.clientIdentifier);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Plex PIN not found or expired. Please restart the authentication process.",
      );
    } else if (response.status === 400) {
      throw new Error(
        "Invalid Plex PIN. Please restart the authentication process.",
      );
    } else {
      throw new Error(`Failed to validate Plex PIN: ${response.statusText}`);
    }
  }

  const authData = await authSchema.parseAsync(await response.json());

  // Check if PIN is still waiting for authorization
  if (!authData.authToken) {
    throw new Error(
      "PIN not yet authorized. Please complete the authorization on Plex and try again.",
    );
  }

  return authData;
};

const getServers = async (token: string) => {
  const url = new URL("https://plex.tv/api/v2/resources");
  url.searchParams.append("X-Plex-Client-Identifier", config.clientIdentifier);
  url.searchParams.append("X-Plex-Token", token);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Plex servers: ${response.statusText}`);
  }

  const data = await sessionsSchema.parseAsync(await response.json());
  return data.filter((device) => device.product === "Plex Media Server");
};

const getUserInfo = async (token: string) => {
  const url = new URL("https://plex.tv/api/v2/user");
  url.searchParams.append("X-Plex-Client-Identifier", config.clientIdentifier);
  url.searchParams.append("X-Plex-Token", token);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Plex user info: ${response.statusText}`);
  }

  const data = await response.json();
  return await userInfoSchema.parseAsync(data);
};

const authPluginSchema = {
  user: {
    fields: {
      plexId: {
        type: "number",
        required: false,
        unique: true,
        returned: true,
      } as const,
      plexUuid: {
        type: "string",
        required: false,
        unique: true,
        returned: true,
      } as const,
      plexUsername: {
        type: "string",
        required: false,
        returned: true,
      } as const,
      plexAuthToken: {
        type: "string",
        required: false,
        returned: true, // Return auth token to client
      } as const,
    },
  },
} satisfies AuthPluginSchema;

export const plex = () => {
  const ERROR_CODES = {
    INVALID_PLEX_AUTH: "Invalid Plex authentication",
    PIN_NOT_AUTHORIZED: "PIN not yet authorized by user",
    UNEXPECTED_ERROR: "Unexpected error",
  } as const;

  return {
    id: "plex-auth",

    endpoints: {
      // Initialize Plex auth flow - returns redirect URL
      initiatePlexAuth: createAuthEndpoint(
        "/plex/auth/initiate",
        {
          method: "GET",
          query: z.object({
            callbackUrl: z.string().url(),
          }),
        },
        async (ctx) => {
          try {
            const { callbackUrl } = ctx.query;
            const auth = await getAuth();
            const authUrl = getUrl(auth, callbackUrl);

            return ctx.redirect(authUrl);
          } catch (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message:
                error instanceof Error
                  ? error.message
                  : ERROR_CODES.UNEXPECTED_ERROR,
            });
          }
        },
      ),

      // Handle Plex callback and complete authentication
      plexCallback: createAuthEndpoint(
        "/plex/auth/callback",
        {
          method: "GET",
          query: authCallbackSchema,
        },
        async (ctx) => {
          try {
            const { id, code } = ctx.query;

            // Validate the PIN and get auth token
            const auth = await isValid({ id, code });

            // The isValid function now checks for authToken internally
            // so we can proceed directly to get user info
            const userInfo = await getUserInfo(auth.authToken!);

            // Check if user already exists by Plex UUID
            const existingUser = await ctx.context.adapter.findOne<{
              id: string;
              plexUuid: string;
            }>({
              model: "user",
              where: [
                {
                  field: "plexUuid",
                  value: userInfo.uuid,
                },
              ],
            });

            let user: UserWithPlex;

            if (!existingUser) {
              // Create new user with Plex data
              const newUser = await ctx.context.internalAdapter.createUser({
                email: userInfo.email,
                name: userInfo.friendlyName,
                image: userInfo.thumb,
                emailVerified: userInfo.confirmed,
                plexId: userInfo.id,
                plexUuid: userInfo.uuid,
                plexUsername: userInfo.username,
                plexAuthToken: auth.authToken,
              });

              if (!newUser) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                  message: "Failed to create user",
                });
              }

              user = newUser as UserWithPlex;

              // Create account record linking user to Plex provider
              await ctx.context.internalAdapter.createAccount({
                userId: user.id,
                accountId: userInfo.uuid, // Use Plex UUID as account ID
                providerId: "plex",
                accessToken: auth.authToken,
              });
            } else {
              // User already exists, update their auth token
              // auth.authToken is guaranteed non-null here since isValid() throws if missing
              const updatedUser = (await ctx.context.internalAdapter.updateUser(
                existingUser.id,
                {
                  plexAuthToken: auth.authToken!,
                },
              )) as UserWithPlex | null;

              if (!updatedUser) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                  message: "Failed to update user token",
                });
              }

              user = updatedUser;

              // Update or create the account record with the new token
              try {
                const existingAccount = await ctx.context.adapter.findOne<{
                  id: string;
                }>({
                  model: "account",
                  where: [
                    {
                      field: "userId",
                      value: user.id,
                    },
                    {
                      field: "providerId",
                      value: "plex",
                    },
                  ],
                });

                if (existingAccount) {
                  // For existing accounts, we'll delete and recreate since update might not work reliably
                  await ctx.context.adapter.delete({
                    model: "account",
                    where: [
                      {
                        field: "id",
                        value: existingAccount.id,
                      },
                    ],
                  });
                }

                // Create new account record (either first time or replacement)
                await ctx.context.internalAdapter.createAccount({
                  userId: user.id,
                  accountId: userInfo.uuid,
                  providerId: "plex",
                  accessToken: auth.authToken,
                });
              } catch (accountError) {
                // If account operations fail, log but don't fail the auth
                console.warn("Failed to update account record:", accountError);
              }
            }

            // Create BetterAuth session
            const session = await ctx.context.internalAdapter.createSession(
              user.id,
              ctx,
            );

            if (!session) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "Failed to create session",
              });
            }

            // Set session cookie using BetterAuth helper
            await setSessionCookie(ctx, { session, user });

            // Redirect to success page or dashboard
            return ctx.redirect("/");
          } catch (error) {
            console.error("Plex auth error:", error);

            // Provide more specific error messages based on the error type
            if (error instanceof Error) {
              if (error.message.includes("PIN not found or expired")) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Your Plex authentication session has expired. Please try signing in again.",
                });
              } else if (error.message.includes("PIN not yet authorized")) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Please complete the authorization on Plex.tv before proceeding.",
                });
              } else if (error.message.includes("Invalid Plex PIN")) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Invalid authentication request. Please try signing in again.",
                });
              }
            }

            throw new APIError("UNAUTHORIZED", {
              message:
                typeof error === "object" &&
                error !== null &&
                "message" in error
                  ? String(error.message)
                  : ERROR_CODES.INVALID_PLEX_AUTH,
            });
          }
        },
      ),

      // Get user's Plex servers
      getPlexServers: createAuthEndpoint(
        "/plex/servers",
        {
          method: "GET",
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          try {
            const { token } = ctx.query;

            if (!token) {
              return ctx.json(
                {
                  success: false,
                  error: "No token provided",
                },
                { status: 401 },
              );
            }

            const servers = await getServers(token);

            return ctx.json({
              success: true,
              servers,
            });
          } catch (error) {
            return ctx.json(
              {
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to fetch servers",
              },
              { status: 500 },
            );
          }
        },
      ),

      // Get user info
      getPlexUser: createAuthEndpoint(
        "/plex/user",
        {
          method: "GET",
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          try {
            const { token } = ctx.query;

            if (!token) {
              return ctx.json(
                {
                  success: false,
                  error: "No token provided",
                },
                { status: 401 },
              );
            }

            const userInfo = await getUserInfo(token);

            return ctx.json({
              success: true,
              user: userInfo,
            });
          } catch (error) {
            return ctx.json(
              {
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to fetch user info",
              },
              { status: 500 },
            );
          }
        },
      ),

      // Health check endpoint
      plexHealthCheck: createAuthEndpoint(
        "/plex/health",
        {
          method: "GET",
        },
        async (ctx) => {
          return ctx.json({
            success: true,
            message: "Plex auth plugin is healthy",
            config: {
              product: config.product,
              clientIdentifier: config.clientIdentifier,
            },
          });
        },
      ),
    },
    schema: mergeSchema(authPluginSchema),
    $ERROR_CODES: ERROR_CODES,
  } satisfies BetterAuthPlugin;
};

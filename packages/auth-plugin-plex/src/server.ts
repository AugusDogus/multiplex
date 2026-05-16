import {
  PlexTvClient,
  authCallbackSchema,
  type PlexConfig,
  type PlexDevice,
  type PlexUserInfo,
} from "@multiplex/plex-query";
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

// Plex configuration
const config: PlexConfig = {
  product: "Multiplex",
  clientIdentifier: "multiplex-app",
  version: "1.0.0",
  platform: "Web",
};

export interface UserWithPlex extends User {
  plexId?: number;
  plexUuid?: string;
  plexUsername?: string;
  plexAuthToken?: string;
}

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

const isValid = async (auth: Pick<z.infer<typeof authSchema>, "id" | "code">) => {
  const url = new URL(`https://plex.tv/api/v2/pins/${auth.id}`);
  url.searchParams.append("code", auth.code);
  url.searchParams.append("X-Plex-Client-Identifier", config.clientIdentifier);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Plex PIN not found or expired. Please restart the authentication process.");
    }

    if (response.status === 400) {
      throw new Error("Invalid Plex PIN. Please restart the authentication process.");
    }

    throw new Error(`Failed to validate Plex PIN: ${response.statusText}`);
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

const getServers = async (token: string): Promise<PlexDevice[]> => {
  return await new PlexTvClient(token, config).getServers();
};

const getUserInfo = async (token: string): Promise<PlexUserInfo> => {
  return await new PlexTvClient(token, config).getUserInfo();
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
              message: error instanceof Error ? error.message : ERROR_CODES.UNEXPECTED_ERROR,
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
              const updatedUser = (await ctx.context.internalAdapter.updateUser(existingUser.id, {
                plexAuthToken: auth.authToken!,
              })) as UserWithPlex | null;

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
            const session = await ctx.context.internalAdapter.createSession(user.id, ctx);

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
              }

              if (error.message.includes("PIN not yet authorized")) {
                throw new APIError("BAD_REQUEST", {
                  message: "Please complete the authorization on Plex.tv before proceeding.",
                });
              }

              if (error.message.includes("Invalid Plex PIN")) {
                throw new APIError("BAD_REQUEST", {
                  message: "Invalid authentication request. Please try signing in again.",
                });
              }
            }

            throw new APIError("UNAUTHORIZED", {
              message:
                typeof error === "object" && error !== null && "message" in error
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
                error: error instanceof Error ? error.message : "Failed to fetch servers",
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
                error: error instanceof Error ? error.message : "Failed to fetch user info",
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

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

const pinAuthSchema = z.object({
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
        returned: true,
      } as const,
    },
  },
} satisfies AuthPluginSchema;

const DEFAULT_CONFIG: PlexConfig = {
  product: "Multiplex",
  clientIdentifier: "multiplex-app",
  version: "1.0.0",
  platform: "Web",
};

export type PlexAuthPluginOptions = Partial<PlexConfig>;

export interface UserWithPlex extends User {
  plexId?: number;
  plexUuid?: string;
  plexUsername?: string;
  plexAuthToken?: string;
}

type PinAuth = z.infer<typeof pinAuthSchema>;
type AuthorizedPinAuth = PinAuth & { authToken: string };

const resolveConfig = (options: PlexAuthPluginOptions = {}): PlexConfig => ({
  product: options.product ?? DEFAULT_CONFIG.product,
  clientIdentifier: options.clientIdentifier ?? DEFAULT_CONFIG.clientIdentifier,
  version: options.version ?? DEFAULT_CONFIG.version,
  platform: options.platform ?? DEFAULT_CONFIG.platform,
});

const createPlexClient = (token: string, config: PlexConfig) => new PlexTvClient(token, config);

const getAuth = async (config: PlexConfig) => {
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

  return await pinAuthSchema.parseAsync(await response.json());
};

const getUrl = (auth: PinAuth, callbackUrl: string, config: PlexConfig) => {
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
  auth: Pick<PinAuth, "id" | "code">,
  config: PlexConfig,
): Promise<AuthorizedPinAuth> => {
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

  const authData = await pinAuthSchema.parseAsync(await response.json());

  // The PIN can exist before the user has approved it in Plex.
  if (!authData.authToken) {
    throw new Error(
      "PIN not yet authorized. Please complete the authorization on Plex and try again.",
    );
  }

  return { ...authData, authToken: authData.authToken };
};

const getServers = async (token: string, config: PlexConfig): Promise<PlexDevice[]> => {
  return await createPlexClient(token, config).getServers();
};

const getUserInfo = async (token: string, config: PlexConfig): Promise<PlexUserInfo> => {
  return await createPlexClient(token, config).getUserInfo();
};

export const plex = (options?: PlexAuthPluginOptions) => {
  const config = resolveConfig(options);
  const ERROR_CODES = {
    INVALID_PLEX_AUTH: "Invalid Plex authentication",
    PIN_NOT_AUTHORIZED: "PIN not yet authorized by user",
    UNEXPECTED_ERROR: "Unexpected error",
  } as const;

  return {
    id: "plex-auth",

    endpoints: {
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
            const auth = await getAuth(config);
            const authUrl = getUrl(auth, callbackUrl, config);

            return ctx.redirect(authUrl);
          } catch (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : ERROR_CODES.UNEXPECTED_ERROR,
            });
          }
        },
      ),

      plexCallback: createAuthEndpoint(
        "/plex/auth/callback",
        {
          method: "GET",
          query: authCallbackSchema,
        },
        async (ctx) => {
          try {
            const { id, code } = ctx.query;

            // Validate the PIN and exchange it for the Plex token used below.
            const auth = await isValid({ id, code }, config);
            const userInfo = await getUserInfo(auth.authToken, config);

            // Match by Plex UUID so repeat sign-ins update the same local user.
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
              // First Plex sign-in creates the local Better Auth user.
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

              // Link the Better Auth account to Plex using the stable Plex UUID.
              await ctx.context.internalAdapter.createAccount({
                userId: user.id,
                accountId: userInfo.uuid,
                providerId: "plex",
                accessToken: auth.authToken,
              });
            } else {
              // Existing users keep their local account, but refresh the Plex token.
              const updatedUser = (await ctx.context.internalAdapter.updateUser(existingUser.id, {
                plexAuthToken: auth.authToken,
              })) as UserWithPlex | null;

              if (!updatedUser) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                  message: "Failed to update user token",
                });
              }

              user = updatedUser;

              try {
                // Recreate the account record with the latest token; account updates
                // have been unreliable through the Better Auth adapter.
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

                await ctx.context.internalAdapter.createAccount({
                  userId: user.id,
                  accountId: userInfo.uuid,
                  providerId: "plex",
                  accessToken: auth.authToken,
                });
              } catch (accountError) {
                // The user/session token is the source of truth, so don't fail auth
                // if the secondary account record cannot be refreshed.
                console.warn("Failed to update account record:", accountError);
              }
            }

            // Create a Better Auth session and set the framework-managed cookie.
            const session = await ctx.context.internalAdapter.createSession(user.id, ctx);

            if (!session) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "Failed to create session",
              });
            }

            await setSessionCookie(ctx, { session, user });

            return ctx.redirect("/");
          } catch (error) {
            console.error("Plex auth error:", error);

            // Map expected PIN failures to friendlier auth errors.
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

            const servers = await getServers(token, config);

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

            const userInfo = await getUserInfo(token, config);

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

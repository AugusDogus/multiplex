import { z } from "zod";

import { getBaseUrl } from "~/lib/base-url";

const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().length(4),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});

const deviceTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});

const deviceErrorSchema = z.object({
  error: z.enum(["authorization_pending", "slow_down", "access_denied", "expired_token"]),
});

export type DeviceAuthorization = z.infer<typeof deviceAuthorizationSchema>;

export type PollResult =
  | { kind: "pending"; intervalSeconds: number }
  | { kind: "authorized"; accessToken: string; expiresInSeconds: number }
  | { kind: "denied"; message: string }
  | { kind: "failed"; message: string };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function beginDeviceAuthorization(): Promise<DeviceAuthorization> {
  const response = await fetch(`${getBaseUrl()}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: "multiplex-mobile",
      scope: "mobile",
    }),
  });
  const data = await readJson(response);
  const parsed = deviceAuthorizationSchema.safeParse(data);

  if (!response.ok || !parsed.success) {
    throw new Error("Multiplex could not start device linking. Check the API URL and try again.");
  }

  return parsed.data;
}

export async function pollDeviceAuthorization(input: {
  deviceCode: string;
  intervalSeconds: number;
}): Promise<PollResult> {
  const response = await fetch(`${getBaseUrl()}/api/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: input.deviceCode,
      client_id: "multiplex-mobile",
    }),
  });
  const data = await readJson(response);
  const token = deviceTokenSchema.safeParse(data);

  if (response.ok && token.success) {
    return {
      kind: "authorized",
      accessToken: token.data.access_token,
      expiresInSeconds: token.data.expires_in,
    };
  }

  const error = deviceErrorSchema.safeParse(data);
  if (!error.success) {
    return {
      kind: "failed",
      message: "Multiplex returned an unreadable device-link response.",
    };
  }

  switch (error.data.error) {
    case "authorization_pending":
      return { kind: "pending", intervalSeconds: input.intervalSeconds };
    case "slow_down":
      return { kind: "pending", intervalSeconds: input.intervalSeconds + 5 };
    case "access_denied":
      return {
        kind: "denied",
        message: "The device-link request was declined. Start again to retry.",
      };
    case "expired_token":
      return {
        kind: "denied",
        message: "The device-link code expired. Start again for a new code.",
      };
    default: {
      const exhaustive: never = error.data.error;
      return exhaustive;
    }
  }
}

export function resolveVerificationUrl(authorization: DeviceAuthorization): string {
  const candidate =
    authorization.verification_uri_complete ??
    `${authorization.verification_uri}?user_code=${encodeURIComponent(authorization.user_code)}`;
  return new URL(candidate, getBaseUrl()).toString();
}

export async function validateAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return false;
    }
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null && "user" in data;
  } catch {
    return false;
  }
}

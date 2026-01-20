import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Plex PIN Authentication
   Client-side implementation of Plex PIN-based authentication
   ──────────────────────────────────────────────────────────── */

// Plex configuration
const PLEX_CONFIG = {
  product: "Multiplex",
  clientIdentifier: "multiplex-spa",
} as const;

// Plex auth response schema
const plexPinSchema = z.object({
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

export type PlexPin = z.infer<typeof plexPinSchema>;

// Plex user info schema (simplified for client-side use)
const plexUserSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  username: z.string(),
  title: z.string(),
  email: z.string(),
  friendlyName: z.string(),
  thumb: z.string(),
  authToken: z.string().nullable(),
});

export type PlexUser = z.infer<typeof plexUserSchema>;

/* ────────────────────────────────────────────────────────────
   PIN Creation & Validation
   ──────────────────────────────────────────────────────────── */

/**
 * Create a new Plex PIN for authentication
 * @returns PlexPin object containing the PIN code and ID
 */
export async function createPlexPin(): Promise<PlexPin> {
  const url = new URL("https://plex.tv/api/v2/pins");
  url.searchParams.append("strong", "true");
  url.searchParams.append("X-Plex-Product", PLEX_CONFIG.product);
  url.searchParams.append("X-Plex-Client-Identifier", PLEX_CONFIG.clientIdentifier);

  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new PlexAuthError(
      `Failed to create Plex PIN: ${response.statusText}`,
      "PIN_CREATION_FAILED",
    );
  }

  const data = await response.json();
  return plexPinSchema.parse(data);
}

/**
 * Check the status of a Plex PIN
 * @param pinId - The PIN ID to check
 * @param code - The PIN code
 * @returns PlexPin object with updated authToken if authenticated
 */
export async function checkPlexPin(pinId: number, code: string): Promise<PlexPin> {
  const url = new URL(`https://plex.tv/api/v2/pins/${pinId}`);
  url.searchParams.append("code", code);
  url.searchParams.append("X-Plex-Client-Identifier", PLEX_CONFIG.clientIdentifier);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new PlexAuthError(
        "Plex PIN not found or expired. Please restart the authentication process.",
        "PIN_EXPIRED",
      );
    } else if (response.status === 400) {
      throw new PlexAuthError(
        "Invalid Plex PIN. Please restart the authentication process.",
        "PIN_INVALID",
      );
    } else {
      throw new PlexAuthError(
        `Failed to validate Plex PIN: ${response.statusText}`,
        "PIN_VALIDATION_FAILED",
      );
    }
  }

  const data = await response.json();
  return plexPinSchema.parse(data);
}

/**
 * Check if a PIN has been authenticated (has an authToken)
 * @param pin - The PlexPin to check
 * @returns true if the PIN has been authenticated
 */
export function isPinAuthenticated(pin: PlexPin): boolean {
  return pin.authToken !== null && pin.authToken.length > 0;
}

/* ────────────────────────────────────────────────────────────
   Auth URL Generation
   ──────────────────────────────────────────────────────────── */

/**
 * Generate the Plex authentication URL for the user to visit
 * @param pin - The PlexPin object
 * @param callbackUrl - Optional callback URL after authentication
 * @returns The URL for the user to authenticate at Plex.tv
 */
export function getPlexAuthUrl(pin: PlexPin, callbackUrl?: string): string {
  const url = new URL("https://app.plex.tv/auth");

  if (callbackUrl) {
    const forwardUrl = new URL(callbackUrl);
    forwardUrl.searchParams.set("code", pin.code);
    forwardUrl.searchParams.set("id", String(pin.id));
    url.searchParams.set("forwardUrl", forwardUrl.toString());
  }

  url.searchParams.set("clientID", PLEX_CONFIG.clientIdentifier);
  url.searchParams.set("code", pin.code);
  url.searchParams.set("context[device][product]", PLEX_CONFIG.product);

  // Plex uses #! for client-side routing
  return url.href.replace("auth", "auth#!");
}

/* ────────────────────────────────────────────────────────────
   User Info
   ──────────────────────────────────────────────────────────── */

/**
 * Fetch Plex user info using an auth token
 * @param token - The Plex auth token
 * @returns PlexUser object with user information
 */
export async function getPlexUserInfo(token: string): Promise<PlexUser> {
  const url = new URL("https://plex.tv/api/v2/user");
  url.searchParams.append("X-Plex-Client-Identifier", PLEX_CONFIG.clientIdentifier);
  url.searchParams.append("X-Plex-Token", token);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new PlexAuthError(
        "Invalid or expired Plex token. Please sign in again.",
        "TOKEN_INVALID",
      );
    }
    throw new PlexAuthError(
      `Failed to fetch Plex user info: ${response.statusText}`,
      "USER_INFO_FAILED",
    );
  }

  const data = await response.json();
  return plexUserSchema.parse(data);
}

/* ────────────────────────────────────────────────────────────
   Polling Utilities
   ──────────────────────────────────────────────────────────── */

export interface PollOptions {
  /** Interval between polls in milliseconds (default: 2000) */
  interval?: number;
  /** Maximum number of attempts before giving up (default: 150 = 5 minutes at 2s intervals) */
  maxAttempts?: number;
  /** Callback called on each poll with the current attempt number */
  onPoll?: (attempt: number) => void;
  /** AbortSignal to cancel polling */
  signal?: AbortSignal;
}

/**
 * Poll for PIN authentication completion
 * @param pin - The PlexPin to poll for
 * @param options - Polling options
 * @returns The authenticated PlexPin with authToken
 */
export async function pollForPinAuth(pin: PlexPin, options: PollOptions = {}): Promise<PlexPin> {
  const { interval = 2000, maxAttempts = 150, onPoll, signal } = options;

  let attempts = 0;

  while (attempts < maxAttempts) {
    // Check if polling was cancelled
    if (signal?.aborted) {
      throw new PlexAuthError("Authentication cancelled", "AUTH_CANCELLED");
    }

    attempts++;
    onPoll?.(attempts);

    try {
      const updatedPin = await checkPlexPin(pin.id, pin.code);

      if (isPinAuthenticated(updatedPin)) {
        return updatedPin;
      }
    } catch (error) {
      // If PIN expired or invalid, rethrow
      if (error instanceof PlexAuthError) {
        if (error.code === "PIN_EXPIRED" || error.code === "PIN_INVALID") {
          throw error;
        }
      }
      // For other errors, continue polling
      console.warn("Poll error, continuing:", error);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new PlexAuthError("Authentication timed out. Please try again.", "AUTH_TIMEOUT");
}

/* ────────────────────────────────────────────────────────────
   Error Class
   ──────────────────────────────────────────────────────────── */

export type PlexAuthErrorCode =
  | "PIN_CREATION_FAILED"
  | "PIN_EXPIRED"
  | "PIN_INVALID"
  | "PIN_VALIDATION_FAILED"
  | "TOKEN_INVALID"
  | "USER_INFO_FAILED"
  | "AUTH_CANCELLED"
  | "AUTH_TIMEOUT";

export class PlexAuthError extends Error {
  constructor(
    message: string,
    public code: PlexAuthErrorCode,
  ) {
    super(message);
    this.name = "PlexAuthError";
  }
}

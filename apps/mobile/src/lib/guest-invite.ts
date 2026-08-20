import {
  guestWatchTogetherBootstrapResponseSchema,
  guestWatchTogetherContinuationResponseSchema,
  type GuestWatchTogetherBootstrapValue,
} from "@multiplex/plex-query";

import { getBaseUrl } from "~/lib/base-url";

export { parseGuestCapability } from "~/lib/guest-invite-url";

export type GuestBootstrapResult =
  | { readonly kind: "joined"; readonly value: GuestWatchTogetherBootstrapValue }
  | { readonly kind: "unavailable"; readonly message: string };

export type GuestContinuationResult =
  | {
      readonly kind: "ready";
      readonly capability: string;
      readonly value: GuestWatchTogetherBootstrapValue;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" };

export async function bootstrapGuestInvite(capability: string): Promise<GuestBootstrapResult> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/watch-together/guest/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability }),
    });
    if (!response.ok) {
      return connectionFailure();
    }
    const body: unknown = await response.json();
    const parsed = guestWatchTogetherBootstrapResponseSchema.safeParse(body);
    if (!parsed.success) {
      return {
        kind: "unavailable",
        message: "This Watch Together link returned an invalid response.",
      };
    }
    if (!parsed.data.ok) {
      return {
        kind: "unavailable",
        message:
          parsed.data.reason === "expired-invite"
            ? "This guest link has expired. Ask the host for a new one."
            : "This Watch Together link is no longer available.",
      };
    }
    return { kind: "joined", value: parsed.data.value };
  } catch {
    return connectionFailure();
  }
}

export async function continueGuestInvite(input: {
  capability: string;
  nextRatingKey: string;
}): Promise<GuestContinuationResult> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/watch-together/guest/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { kind: "pending" };
    const body: unknown = await response.json();
    const parsed = guestWatchTogetherContinuationResponseSchema.safeParse(body);
    if (!parsed.success) return { kind: "pending" };
    if (parsed.data.ok) {
      return {
        kind: "ready",
        capability: parsed.data.capability,
        value: parsed.data.value,
      };
    }
    return parsed.data.reason === "pending" ? { kind: "pending" } : { kind: "unavailable" };
  } catch {
    return { kind: "pending" };
  }
}

function connectionFailure(): GuestBootstrapResult {
  return {
    kind: "unavailable",
    message: "We couldn't reach the session. Check your connection and try again.",
  };
}

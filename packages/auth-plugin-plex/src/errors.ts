const UNAVAILABLE = "unavailable";

export type PlexAuthError = typeof UNAVAILABLE;

export const PlexAuthError = {
  queryParameter: "plexAuthError",
  unavailable: UNAVAILABLE,
  parse(value: string | null): PlexAuthError | null {
    return value === UNAVAILABLE ? UNAVAILABLE : null;
  },
} as const;

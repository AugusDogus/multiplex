"use client";

import { Predicate } from "effect";
import { catchError, type ErrorInfo } from "next/error";
import { PlexErrorFallback } from "~/components/plex-error-fallback";

// retry() re-fetches the boundary's Server Component children (e.g. the
// sidebar's Plex context), unlike a client-only error-boundary reset.
function PlexErrorBoundaryFallback(
  _props: Record<never, never>,
  { error, retry }: ErrorInfo,
) {
  return (
    <PlexErrorFallback
      error={Predicate.isError(error) ? error : new Error(String(error))}
      retry={retry}
    />
  );
}

export const PlexErrorWrapper = catchError(PlexErrorBoundaryFallback);

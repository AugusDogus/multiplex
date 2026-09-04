"use client";

import { catchError, type ErrorInfo } from "next/error";
import { PlexErrorFallback } from "~/components/plex-error-fallback";

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

// retry() re-fetches the boundary's Server Component children (e.g. the
// sidebar's Plex context), unlike a client-only error-boundary reset.
function PlexErrorBoundaryFallback(
  _props: Record<never, never>,
  { error, retry }: ErrorInfo,
) {
  return (
    <PlexErrorFallback error={toError(error)} resetErrorBoundary={retry} />
  );
}

export const PlexErrorWrapper = catchError(PlexErrorBoundaryFallback);

"use client";

import { Predicate } from "effect";
import { catchError, type ErrorInfo } from "next/error";
import type React from "react";
import { PlexErrorFallback } from "~/components/plex-error-fallback";

// retry() re-fetches the boundary's Server Component children (e.g. the
// sidebar's Plex context), unlike a client-only error-boundary reset.
function PlexErrorBoundaryFallback(
  _props: Record<never, never>,
  { error, retry }: ErrorInfo,
): React.ReactElement {
  return (
    <PlexErrorFallback
      message={Predicate.isError(error) ? error.message : String(error)}
      retry={retry}
    />
  );
}

export const PlexErrorWrapper = catchError(PlexErrorBoundaryFallback);

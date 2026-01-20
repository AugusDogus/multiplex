"use client";

import { ErrorBoundary } from "react-error-boundary";
import { PlexErrorFallback } from "~/components/plex-error-fallback";

interface PlexErrorWrapperProps {
  children: React.ReactNode;
}

export function PlexErrorWrapper({ children }: PlexErrorWrapperProps) {
  return (
    <ErrorBoundary
      FallbackComponent={PlexErrorFallback}
      onError={(error, errorInfo) => {
        console.error("Plex Error Boundary caught an error:", error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

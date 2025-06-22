"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

interface PlexErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export function PlexErrorFallback({
  error,
  resetErrorBoundary,
}: PlexErrorFallbackProps) {
  return (
    <Card className="mx-4 my-4">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Plex Connection Error
        </CardTitle>
        <CardDescription>
          There was a problem connecting to your Plex servers. This could be due
          to network issues, server maintenance, or configuration problems.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted rounded-md p-3">
          <p className="text-muted-foreground font-mono text-sm">
            {error.message}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={resetErrorBoundary}
            variant="default"
            size="sm"
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>

          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="sm"
          >
            Reload Page
          </Button>
        </div>

        <div className="text-muted-foreground text-xs">
          <p>If this problem persists:</p>
          <ul className="mt-1 ml-4 list-disc space-y-1">
            <li>Check your Plex server is running and accessible</li>
            <li>Verify your authentication token is valid</li>
            <li>Check your network connection</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

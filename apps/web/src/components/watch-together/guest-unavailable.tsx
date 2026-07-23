"use client";

import { ShieldAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { GuestPageFrame } from "~/components/watch-together/guest-page-frame";

interface GuestUnavailableProps {
  message: string;
  onRetry: () => void;
}

export function GuestUnavailable({ message, onRetry }: GuestUnavailableProps) {
  return (
    <GuestPageFrame>
      <ShieldAlert className="text-muted-foreground size-8" />
      <h1 className="text-2xl font-semibold">Session unavailable</h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </GuestPageFrame>
  );
}

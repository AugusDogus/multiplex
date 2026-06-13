"use client";

import { Button } from "~/components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps) {
  return (
    <div className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground mt-2 max-w-md">
          {error.message ||
            "An unexpected error occurred while loading this page."}
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

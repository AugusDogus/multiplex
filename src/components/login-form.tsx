"use client";

import { Command } from "lucide-react";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth/client";
import { cn } from "~/lib/utils";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const handlePlexLogin = async () => {
    try {
      await authClient.plex.signIn();
    } catch (error) {
      console.error("Failed to initiate Plex authentication:", error);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <a href="#" className="flex flex-col items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <Command className="size-6 dark:text-white" />
            </div>
            <span className="sr-only">Multiplex</span>
          </a>
          <h1 className="text-xl font-bold">Welcome to Multiplex</h1>
          <div className="text-muted-foreground text-center text-sm">
            Sign in with your Plex account to continue
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Button onClick={handlePlexLogin} className="w-full" size="lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="mr-2 h-5 w-5"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            Continue with Plex
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground text-center text-xs text-balance">
        By continuing, you agree to the{" "}
        <a
          href="https://www.plex.tv/about/privacy-legal/plex-terms-of-service/"
          className="hover:text-primary underline underline-offset-4"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://www.plex.tv/about/privacy-legal/"
          className="hover:text-primary underline underline-offset-4"
        >
          Privacy Policy
        </a>
        .
      </div>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Command, Loader2, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import {
  createPlexPin,
  getPlexAuthUrl,
  pollForPinAuth,
  getPlexUserInfo,
  type PlexPin,
  PlexAuthError,
} from "../lib/auth/plex-auth";
import { useAuth, type StoredUser } from "../lib/auth/token-storage";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type AuthState =
  | { status: "idle" }
  | { status: "authenticating"; pin: PlexPin }
  | { status: "error"; message: string };

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [authState, setAuthState] = useState<AuthState>({ status: "idle" });
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const handlePlexLogin = useCallback(async () => {
    // Cancel any existing polling
    abortController?.abort();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Create PIN and start auth
      const pin = await createPlexPin();
      const authUrl = getPlexAuthUrl(pin);

      setAuthState({ status: "authenticating", pin });

      // Open Plex auth in new tab
      window.open(authUrl, "_blank", "noopener,noreferrer");

      // Poll for completion
      const authenticatedPin = await pollForPinAuth(pin, {
        interval: 2000,
        maxAttempts: 150,
        signal: controller.signal,
      });

      if (!authenticatedPin.authToken) {
        throw new PlexAuthError("No auth token received", "TOKEN_INVALID");
      }

      // Fetch user info
      const plexUser = await getPlexUserInfo(authenticatedPin.authToken);

      const user: StoredUser = {
        id: plexUser.id,
        uuid: plexUser.uuid,
        username: plexUser.username,
        friendlyName: plexUser.friendlyName,
        email: plexUser.email,
        thumb: plexUser.thumb,
      };

      // Store credentials and navigate
      login(authenticatedPin.authToken, user);
      void navigate({ to: "/" });
    } catch (error) {
      if (error instanceof PlexAuthError && error.code === "AUTH_CANCELLED") {
        setAuthState({ status: "idle" });
        return;
      }

      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      setAuthState({ status: "error", message });
    }
  }, [abortController, login, navigate]);

  const retry = useCallback(() => {
    setAuthState({ status: "idle" });
  }, []);

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm authState={authState} onLogin={handlePlexLogin} onRetry={retry} />
      </div>
    </div>
  );
}

function LoginForm({
  className,
  authState,
  onLogin,
  onRetry,
  ...props
}: React.ComponentProps<"div"> & {
  authState: AuthState;
  onLogin: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <a href="#" className="flex flex-col items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <Command className="size-6" />
            </div>
            <span className="sr-only">Multiplex</span>
          </a>
          <h1 className="text-xl font-bold">Welcome to Multiplex</h1>
          <div className="text-muted-foreground text-center text-sm">
            {authState.status === "idle" && "Sign in with your Plex account to continue"}
            {authState.status === "authenticating" && "Complete sign in on Plex.tv..."}
            {authState.status === "error" && "Authentication failed"}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {authState.status === "idle" && (
            <Button onClick={onLogin} className="w-full" size="lg">
              <PlexIcon className="mr-2 h-5 w-5" />
              Continue with Plex
            </Button>
          )}

          {authState.status === "authenticating" && (
            <Button disabled className="w-full" size="lg">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Waiting for authorization...
            </Button>
          )}

          {authState.status === "error" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-2 py-2">
                <AlertCircle className="text-destructive h-8 w-8" />
                <p className="text-muted-foreground text-center text-sm">{authState.message}</p>
              </div>
              <Button onClick={onRetry} variant="outline" className="w-full" size="lg">
                Try Again
              </Button>
            </div>
          )}
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

function PlexIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

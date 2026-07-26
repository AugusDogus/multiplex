"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { clearAuthHintCookie } from "~/lib/auth/clear-auth-hint";
import { authClient } from "~/lib/auth/client";

function isConfirmedAuthDeath(error: { status: number } | null): boolean {
  return error?.status === 401 || error?.status === 419;
}

/**
 * Layer 3 safety net for mid-session auth loss (other-tab logout, expiry).
 * Full navigation + neutral blank screen — never the app shell skeleton.
 *
 * Transient probe failures must not look like logout: only a resolved empty
 * session or explicit 401/419 tears the shell down.
 */
export function SessionChangeGate({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = authClient.useSession();
  const [hadSession, setHadSession] = useState(false);
  const signingOutRef = useRef(false);

  if (session && !hadSession) {
    setHadSession(true);
  }

  const lostSession =
    !isPending &&
    hadSession &&
    ((!session && !error) || isConfirmedAuthDeath(error));

  useEffect(() => {
    if (!lostSession || signingOutRef.current) {
      return;
    }

    signingOutRef.current = true;
    clearAuthHintCookie();
    window.location.replace("/login");
  }, [lostSession]);

  if (lostSession) {
    return <div className="bg-background h-svh w-full" aria-busy="true" />;
  }

  return children;
}

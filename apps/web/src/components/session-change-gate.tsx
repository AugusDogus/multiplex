"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { clearAuthHintCookie } from "~/lib/auth/clear-auth-hint";
import { authClient } from "~/lib/auth/client";

/**
 * Layer 3 safety net for mid-session auth loss (other-tab logout, expiry).
 * Full navigation + neutral blank screen — never the app shell skeleton.
 */
export function SessionChangeGate({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [hadSession, setHadSession] = useState(false);
  const signingOutRef = useRef(false);

  if (session && !hadSession) {
    setHadSession(true);
  }

  const lostSession = !isPending && !session && hadSession;

  useEffect(() => {
    if (isPending || session || !hadSession || signingOutRef.current) {
      return;
    }

    signingOutRef.current = true;
    clearAuthHintCookie();
    window.location.replace("/login");
  }, [hadSession, isPending, session]);

  if (lostSession) {
    return <div className="bg-background h-svh w-full" aria-busy="true" />;
  }

  return children;
}

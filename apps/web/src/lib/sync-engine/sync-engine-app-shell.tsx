"use client";

import type { ReactNode } from "react";

import { SessionChangeGate } from "~/components/session-change-gate";
import { authClient } from "~/lib/auth/client";
import { useReconcileAuthHint } from "~/lib/auth/use-auth-hint";

import { SyncEngineProvider } from "./provider";

function isConfirmedAuthDeath(error: { status: number } | null): boolean {
  return error?.status === 401 || error?.status === 419;
}

/** Client boundary so the authenticated app shell can boot OPFS sync. */
export function SyncEngineAppShell({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = authClient.useSession();

  // Keep sync + hint stable while a probe fails transiently (network blip).
  const probeUncertain =
    !isPending && !session && !!error && !isConfirmedAuthDeath(error);

  useReconcileAuthHint(
    isPending || probeUncertain ? undefined : (session?.user ?? null),
  );

  return (
    <SessionChangeGate>
      <SyncEngineProvider
        userId={session?.user?.id ?? null}
        isSessionPending={isPending || probeUncertain}
      >
        {children}
      </SyncEngineProvider>
    </SessionChangeGate>
  );
}

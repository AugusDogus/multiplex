"use client";

import type { ReactNode } from "react";

import { SessionChangeGate } from "~/components/session-change-gate";
import { authClient } from "~/lib/auth/client";
import { useReconcileAuthHint } from "~/lib/auth/use-auth-hint";

import { SyncEngineProvider } from "./provider";

/** Client boundary so the authenticated app shell can boot OPFS sync. */
export function SyncEngineAppShell({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  useReconcileAuthHint(isPending ? undefined : (session?.user ?? null));

  return (
    <SessionChangeGate>
      <SyncEngineProvider
        userId={session?.user?.id ?? null}
        isSessionPending={isPending}
      >
        {children}
      </SyncEngineProvider>
    </SessionChangeGate>
  );
}

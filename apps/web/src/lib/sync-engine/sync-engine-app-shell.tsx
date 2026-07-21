"use client";

import type { ReactNode } from "react";

import { authClient } from "~/lib/auth/client";

import { SyncEngineProvider } from "./provider";

/** Client boundary so the authenticated app shell can boot OPFS sync. */
export function SyncEngineAppShell({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();

  return (
    <SyncEngineProvider
      userId={session?.user?.id ?? null}
      isSessionPending={isPending}
    >
      {children}
    </SyncEngineProvider>
  );
}

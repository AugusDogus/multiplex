"use client";

import { AppSidebarSkeleton } from "~/components/app-sidebar-skeleton";
import { authHintFromUser } from "~/lib/auth/auth-hint";
import { authClient } from "~/lib/auth/client";

/**
 * Share the app shell's Better Auth session while the server sidebar streams.
 * Until the session resolves, keep the profile slot in its skeleton state.
 */
export function AppSidebarSkeletonFallback() {
  const { data: session } = authClient.useSession();
  const hint = session ? authHintFromUser(session.user) : null;
  return <AppSidebarSkeleton hint={hint} />;
}

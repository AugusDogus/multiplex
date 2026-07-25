"use client";

import { AppSidebarSkeleton } from "~/components/app-sidebar-skeleton";
import { useAuthHint } from "~/lib/auth/use-auth-hint";

/**
 * Suspense fallback for the app sidebar. Reads the auth hint after mount so
 * the layout never calls `cookies()` outside Suspense (blocking prerender).
 */
export function AppSidebarSkeletonFallback() {
  const hint = useAuthHint();
  return <AppSidebarSkeleton hint={hint} />;
}

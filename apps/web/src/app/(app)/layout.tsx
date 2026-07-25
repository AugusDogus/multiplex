import { cookies } from "next/headers";
import { Suspense } from "react";

import {
  AppContentGateFallback,
  AppPlexContentGate,
  AppShellMobileNav,
  AppShellSidebar,
} from "~/components/app-shell";
import { AppScrollContainer } from "~/components/app-scroll-container";
import { AppSidebarSkeleton } from "~/components/app-sidebar-skeleton";
import { SidebarProvider } from "~/components/ui/sidebar";
import { AUTH_HINT_COOKIE, parseAuthHint } from "~/lib/auth/auth-hint";
import { SyncEngineAppShell } from "~/lib/sync-engine/sync-engine-app-shell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const hint = parseAuthHint((await cookies()).get(AUTH_HINT_COOKIE)?.value);

  return (
    <SyncEngineAppShell>
      <div className="h-svh max-w-screen overflow-hidden overscroll-none">
        <SidebarProvider className="h-full min-h-0 overflow-hidden">
          <Suspense fallback={<AppSidebarSkeleton hint={hint} />}>
            <AppShellSidebar />
          </Suspense>
          <AppScrollContainer>
            <Suspense fallback={<AppContentGateFallback />}>
              <AppPlexContentGate>{children}</AppPlexContentGate>
            </Suspense>
          </AppScrollContainer>
          <Suspense fallback={null}>
            <AppShellMobileNav />
          </Suspense>
        </SidebarProvider>
      </div>
    </SyncEngineAppShell>
  );
}

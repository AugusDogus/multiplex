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

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="h-svh max-w-screen overflow-hidden overscroll-none">
      <SidebarProvider className="h-full min-h-0 overflow-hidden">
        <Suspense fallback={<AppSidebarSkeleton />}>
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
  );
}

import { Suspense } from "react";

import {
  AppContentGateFallback,
  AppPlexContentGate,
  AppShellMobileNav,
  AppShellSidebar,
} from "~/components/app-shell";
import { AppSidebarSkeleton } from "~/components/app-sidebar-skeleton";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { HydrateClient } from "~/trpc/server";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <HydrateClient>
      <div className="max-w-screen overflow-hidden">
        <SidebarProvider>
          <Suspense fallback={<AppSidebarSkeleton />}>
            <AppShellSidebar />
          </Suspense>
          <SidebarInset className="w-0 max-w-full min-w-0 flex-1">
            <Suspense fallback={<AppContentGateFallback />}>
              <AppPlexContentGate>{children}</AppPlexContentGate>
            </Suspense>
          </SidebarInset>
          <Suspense fallback={null}>
            <AppShellMobileNav />
          </Suspense>
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}

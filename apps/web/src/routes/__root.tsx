import React from "react";
import {
  HeadContent,
  Navigate,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ThemeProvider } from "tanstack-theme-kit";

import { AppSidebar } from "../components/app-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "../components/ui/breadcrumb";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { ThemeToggle } from "../components/theme-toggle";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

// Skeleton for the main content area during initial load
function MainContentSkeleton() {
  return (
    <div className="flex flex-col gap-8 py-4">
      {/* Continue Watching section skeleton */}
      <div className="flex flex-col gap-y-4">
        <div className="flex items-center justify-between px-8">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="w-full max-w-full overflow-hidden">
          <div className="flex gap-4 px-8 pb-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 space-y-2">
                <Skeleton className="h-[240px] w-[160px] rounded-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
import { useAuth } from "../lib/auth/token-storage";
import { LayoutDataProvider, useLayoutData } from "../contexts/layout-data-context";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Multiplex" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),

  component: RootComponent,
  pendingComponent: PendingComponent,
  shellComponent: RootDocument,
});

function PendingComponent() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </ThemeProvider>
  );
}

function RootComponent() {
  const { token, user, isAuthenticated } = useAuth();
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  // Login page gets minimal layout
  if (isLoginPage) {
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <Outlet />
      </ThemeProvider>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  // Authenticated - render the full layout
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LayoutDataProvider token={token}>
        <AuthenticatedLayout user={user} />
      </LayoutDataProvider>
    </ThemeProvider>
  );
}

function AuthenticatedLayout({ 
  user 
}: { 
  user: { id: number; uuid: string; username: string; friendlyName: string; email: string; thumb: string } | null;
}) {
  const { servers, userInfo, isAllDataLoading } = useLayoutData();
  const { token } = useAuth();

  const sidebarUser = user
    ? {
        name: user.friendlyName || user.username,
        email: user.email,
        avatar: user.thumb || "",
      }
    : null;

  // ALWAYS render the same DOM structure - sidebar and main content area
  // The isLoading prop tells children to show skeletons
  return (
    <div className="max-w-screen overflow-hidden">
      <SidebarProvider>
        <AppSidebar
          user={sidebarUser}
          servers={servers}
          userInfo={userInfo}
          token={token}
          isLoading={isAllDataLoading}
        />
        <SidebarInset className="min-w-0 flex-1 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Home</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
            </div>
          </header>
          <main className="flex min-w-0 flex-1 flex-col gap-6 p-4">
            {isAllDataLoading ? <MainContentSkeleton /> : <Outlet />}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

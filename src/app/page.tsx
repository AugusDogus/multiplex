import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "~/components/app-sidebar";
import { ContinueWatching } from "~/components/continue-watching";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SearchForm } from "~/components/search-form";
import { ThemeToggle } from "~/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "~/components/ui/breadcrumb";
import { Separator } from "~/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import { api, HydrateClient } from "~/trpc/server";

export default async function Page() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  // Fetch data using tRPC procedures
  const [servers, userInfo, continueWatchingItems] = await Promise.all([
    api.plex.getServers(),
    api.plex.getUserInfo(),
    api.plex.getAllContinueWatching(),
  ]);

  if (!servers || !userInfo) {
    return null;
  }

  // If no servers are configured, show setup message
  if (servers.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Multiplex</h1>
          <p className="text-muted-foreground mt-2">
            No Plex servers found. Please configure your Plex account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <HydrateClient>
      <div className="max-w-screen overflow-hidden">
        <SidebarProvider>
          <PlexErrorWrapper>
            <AppSidebar
              session={session}
              servers={servers}
              userInfo={userInfo}
            />
          </PlexErrorWrapper>
          <SidebarInset className="w-0 max-w-full min-w-0 flex-1">
            <header className="flex h-16 shrink-0 items-center gap-2">
              <div className="flex w-full items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>Home</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                  <SearchForm className="w-fit sm:ml-auto sm:w-auto md:w-full" />
                  <ThemeToggle />
                </div>
              </div>
            </header>
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <ContinueWatching items={continueWatchingItems} />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </HydrateClient>
  );
}

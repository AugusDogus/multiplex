import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "~/components/app-sidebar";
import { ContinueWatching } from "~/components/continue-watching";
import { PlexErrorWrapper } from "~/components/plex-error-wrapper";
import { SearchForm } from "~/components/search-form";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Home</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Dashboard</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <SearchForm className="w-full sm:ml-auto sm:w-auto" />
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

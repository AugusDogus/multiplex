"use client";

// Adapted from Nimbus and T3 Code's settings shell, MIT.
// See public/licenses/t3-code/NOTICE.
import { ArrowLeft, Command, Palette } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { useSidebar } from "~/components/ui/sidebar-context";

const sidebarStyle: CSSProperties & Record<`--${string}`, string> = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "4rem",
};

function SettingsSidebar() {
  const { setOpenMobile } = useSidebar();
  const closeNavigation = () => setOpenMobile(false);
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="h-16 justify-center px-3 group-data-[collapsible=icon]:px-0">
        <Link
          href="/"
          aria-label="Multiplex home"
          onClick={closeNavigation}
          className="text-foreground focus-visible:ring-ring flex h-12 items-center gap-3 rounded-[14px] px-2 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2"
        >
          <Command className="size-8" />
          <span className="font-semibold group-data-[collapsible=icon]:hidden">
            Multiplex
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-4 pt-4">
        <nav aria-label="Settings">
          <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-0">
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive
                  tooltip="Appearance"
                  className="h-10 gap-3 rounded-[14px] px-3 group-data-[collapsible=icon]:mx-auto"
                  render={
                    <Link
                      href="/settings/appearance"
                      aria-current="page"
                      onClick={closeNavigation}
                    />
                  }
                >
                  <Palette strokeWidth={1.7} />
                  <span>Appearance</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] group-data-[collapsible=icon]:px-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to Multiplex"
              className="h-10 gap-3 rounded-[14px] px-3 group-data-[collapsible=icon]:mx-auto"
              render={<Link href="/" onClick={closeNavigation} />}
            >
              <ArrowLeft strokeWidth={1.7} />
              <span>Back to Multiplex</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      style={sidebarStyle}
      className="settings-surface h-dvh min-h-0 overflow-hidden"
    >
      <SettingsSidebar />
      <SidebarInset className="settings-surface min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
        <header className="settings-surface bg-background border-border/40 sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <SidebarTrigger className="text-muted-foreground size-8 shrink-0" />
          <Breadcrumb aria-label="Settings breadcrumb">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/settings" />}>
                  Settings
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Appearance</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

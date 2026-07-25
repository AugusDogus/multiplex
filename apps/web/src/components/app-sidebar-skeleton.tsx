import packageJson from "~/../package.json";

import { Command } from "lucide-react";
import Link from "next/link";

import { SidebarUserSlot } from "~/components/sidebar-user-slot";
import { Skeleton } from "~/components/ui/skeleton";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import type { AuthHint } from "~/lib/auth/auth-hint";

export function AppSidebarSkeleton({
  hint = null,
}: {
  hint?: AuthHint | null;
}) {
  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state="expanded"
      data-variant="inset"
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent"
      />
      <div
        data-slot="sidebar-container"
        className="fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) p-2 md:flex"
      >
        <div className="bg-sidebar flex h-full w-full flex-col gap-2 p-2">
          {/* Brand never changes — keep the real mark, don't pulse it. */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/">
                  <div className="text-sidebar-primary flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Command className="size-fit dark:text-white" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Multiplex</span>
                    <span className="truncate text-xs">
                      v{packageJson.version}
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="flex flex-1 flex-col gap-2 px-2 pt-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>

          {/* Profile chrome from the auth hint — same slot the real NavUser fills. */}
          <div className="mt-auto">
            <SidebarUserSlot hint={hint} />
          </div>
        </div>
      </div>
    </div>
  );
}

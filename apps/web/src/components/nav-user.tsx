"use client";

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import type { PlexUserInfo } from "@multiplex/plex-query";
import { signOut } from "~/lib/auth/client";

export function NavUser({
  user,
  userInfo,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
  userInfo: PlexUserInfo;
}) {
  const { isMobile } = useSidebar();
  const initials = user.name
    .split(" ")
    .map((name) => name[0])
    .join("");

  const hasPlexPass = userInfo.subscription?.active ?? false;
  const subscriptionText = hasPlexPass
    ? userInfo.subscriptionDescription
    : "Upgrade to Pro";
  const subscriptionUrl = hasPlexPass
    ? "https://clients.plex.tv/subscription"
    : "https://www.plex.tv/plans/";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="rounded-lg">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={
                  <a
                    href={subscriptionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={subscriptionText ?? "Plex subscription"}
                  />
                }
              >
                <Sparkles />
                {subscriptionText}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={
                  <a
                    href="https://app.plex.tv/desktop/#!/settings/account"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Account"
                  />
                }
              >
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <a
                    href="https://clients.plex.tv/users/payments"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Billing"
                  />
                }
              >
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                // Always leave even if signOut rejects (document gate clears junk).
                await signOut().catch(() => undefined);
                // Full navigation: avoid flashing the signed-in shell on the way out.
                window.location.replace("/login");
              }}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

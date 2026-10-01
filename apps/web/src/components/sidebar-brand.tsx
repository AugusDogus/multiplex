import packageJson from "~/../package.json";
import { Command } from "lucide-react";
import Link from "next/link";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";

export function SidebarBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link href="/" />}>
          <div className="text-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
            <Command className="size-fit" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">Multiplex</span>
            <span className="truncate text-xs">v{packageJson.version}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

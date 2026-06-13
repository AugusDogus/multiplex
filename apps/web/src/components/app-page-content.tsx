import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface AppPageContentProps {
  children: ReactNode;
  spacing?: "home" | "default";
  className?: string;
}

export function AppPageContent({
  children,
  spacing = "default",
  className,
}: AppPageContentProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col p-4 pb-24 md:pb-4",
        spacing === "home" ? "gap-8 md:gap-10" : "gap-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

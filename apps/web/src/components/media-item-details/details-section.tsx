import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface DetailsSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
  bleed?: boolean;
}

export function DetailsSection({
  title,
  children,
  className,
  bleed,
}: DetailsSectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      <div className={cn(bleed && "-mx-4 sm:mx-0")}>{children}</div>
    </section>
  );
}

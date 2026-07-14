import { cn } from "~/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // foreground/10 keeps visible contrast in both themes — bg-accent is
        // nearly identical to the light-mode page background (oklch 0.97 on 1).
        "bg-foreground/10 animate-pulse rounded-md",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };

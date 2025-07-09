import { cn } from "~/lib/utils";

interface TvGuideGridParentProps {
  children: React.ReactNode;
  className?: string;
}

export function TvGuideGridParent({
  children,
  className,
}: TvGuideGridParentProps) {
  return (
    <div
      className={cn(
        "border-t border-l border-solid border-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

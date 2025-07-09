import { cn } from "~/lib/utils";

interface TvGuideGridParentProps {
  children: React.ReactNode;
  className?: string;
}

export function TvGuideGridParent({
  children,
  className,
}: TvGuideGridParentProps) {
  return <div className={cn("h-8", className)}>{children}</div>;
}

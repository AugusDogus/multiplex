import { cn } from "~/lib/utils";

interface TvGuideGridChildProps {
  width: number | string;
  children?: React.ReactNode;
  className?: string;
}

export function TvGuideGridChild({
  width,
  children,
  className,
}: TvGuideGridChildProps) {
  const widthStyle = typeof width === "number" ? `${width}%` : width;

  return (
    <div
      className={cn(
        "border-r border-solid border-transparent transition-all duration-500 ease-in",
        className,
      )}
      style={{ width: widthStyle }}
    >
      {children}
    </div>
  );
}

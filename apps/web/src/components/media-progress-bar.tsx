import { cn } from "~/lib/utils";

interface MediaProgressBarProps {
  /** Playback progress as a percentage (0-100). */
  value: number;
  /** Classes for the track (the outer container). */
  className?: string;
  /** Extra classes for the fill (e.g. a fixed color or transition). */
  fillClassName?: string;
}

export function MediaProgressBar({
  value,
  className,
  fillClassName,
}: MediaProgressBarProps) {
  return (
    <div className={className}>
      <div
        className={cn("h-full", fillClassName)}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

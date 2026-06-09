import { cn } from "~/lib/utils";

interface MediaProgressBarProps {
  /** Playback progress as a percentage (0-100). */
  value: number;
  /**
   * Luminance-adaptive fill color sampled from the artwork behind the bar.
   * When omitted, the fill color must be supplied via `fillClassName`.
   */
  progressColor?: "dark" | "light";
  /** Classes for the track (the outer container). */
  className?: string;
  /** Extra classes for the fill (e.g. a fixed color or transition). */
  fillClassName?: string;
}

export function MediaProgressBar({
  value,
  progressColor,
  className,
  fillClassName,
}: MediaProgressBarProps) {
  return (
    <div className={className}>
      <div
        className={cn(
          "h-full",
          progressColor === "dark" && "bg-dark-primary",
          progressColor === "light" && "bg-light-primary",
          fillClassName,
        )}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

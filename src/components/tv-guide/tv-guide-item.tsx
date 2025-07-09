import { cn } from "~/lib/utils";
import type { TvGuideItemProps } from "~/types/tv-guide";

// Simplified color palette using CSS classes with built-in hover states
const programColors = [
  "bg-blue-500/70 hover:bg-blue-400/80",
  "bg-green-500/70 hover:bg-green-400/80",
  "bg-purple-500/70 hover:bg-purple-400/80",
  "bg-orange-500/70 hover:bg-orange-400/80",
  "bg-pink-500/70 hover:bg-pink-400/80",
  "bg-teal-500/70 hover:bg-teal-400/80",
  "bg-red-500/70 hover:bg-red-400/80",
  "bg-indigo-500/70 hover:bg-indigo-400/80",
  "bg-yellow-500/70 hover:bg-yellow-400/80",
  "bg-cyan-500/70 hover:bg-cyan-400/80",
];

export function TvGuideItem({
  program,
  width,
  left,
  index,
  onClick,
  className,
}: TvGuideItemProps) {
  const colorClass = programColors[index % programColors.length];

  const handleClick = () => {
    if (onClick) {
      onClick(program);
    }
  };

  return (
    <div
      className={cn(
        "border-card absolute m-0.5 flex min-h-16 flex-col items-start justify-start rounded-md border-2 p-2",
        "cursor-pointer overflow-hidden transition-all duration-500 ease-in",
        colorClass,
        className,
      )}
      style={{ left, width }}
      onClick={handleClick}
    >
      {/* Show Title */}
      <div className="w-full text-sm leading-tight font-semibold text-nowrap text-white drop-shadow-sm">
        {program.grandparentTitle ?? program.title}
      </div>

      {/* Season and Episode */}
      {(program.parentIndex != null || program.index != null) && (
        <div className="w-full text-xs leading-tight text-nowrap text-white/90 drop-shadow-sm">
          {program.parentIndex != null && `S${program.parentIndex}`}
          {program.parentIndex != null && program.index != null && " · "}
          {program.index != null && `E${program.index}`}
        </div>
      )}
    </div>
  );
}

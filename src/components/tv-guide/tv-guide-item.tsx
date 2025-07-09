import { cn } from "~/lib/utils";
import type { TvGuideItemProps } from "~/types/tv-guide";

// Simple color palette for program backgrounds
const programColors = [
  "bg-blue-500/70",
  "bg-green-500/70",
  "bg-purple-500/70",
  "bg-orange-500/70",
  "bg-pink-500/70",
  "bg-teal-500/70",
  "bg-red-500/70",
  "bg-indigo-500/70",
  "bg-yellow-500/70",
  "bg-cyan-500/70",
];

const programHoverColors = [
  "hover:bg-blue-400/80",
  "hover:bg-green-400/80",
  "hover:bg-purple-400/80",
  "hover:bg-orange-400/80",
  "hover:bg-pink-400/80",
  "hover:bg-teal-400/80",
  "hover:bg-red-400/80",
  "hover:bg-indigo-400/80",
  "hover:bg-yellow-400/80",
  "hover:bg-cyan-400/80",
];

function getProgramBackgroundColor(index: number): string {
  return programColors[index % programColors.length]!;
}

function getProgramHoverColor(index: number): string {
  return programHoverColors[index % programHoverColors.length]!;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRemainingTime(endTime: number): string {
  const now = Date.now();
  const remaining = Math.max(0, endTime * 1000 - now);
  const minutes = Math.floor(remaining / (1000 * 60));
  return minutes > 0 ? `${minutes}m left` : "";
}

export function TvGuideItem({
  program,
  width,
  left,
  index,
  onClick,
  className,
}: TvGuideItemProps) {
  const isFlexOrPaused = program.type === "flex" || program.isPaused;
  const isCurrentlyAiring = program.onAir;

  // Get timing information from Media array
  const startTime = program.Media[0]?.beginsAt ?? 0;
  const endTime = program.Media[0]?.endsAt ?? 0;

  const bgColor = getProgramBackgroundColor(index);
  const hoverColor = getProgramHoverColor(index);

  const handleClick = () => {
    if (onClick && program.type !== "flex") {
      onClick(program);
    }
  };

  // Calculate percentage width for responsive text display
  const widthValue = parseFloat(width.replace("%", ""));
  const showFullInfo = widthValue > 8; // Show full info if width > 8%
  const showTimeInfo = widthValue > 15; // Show time info if width > 15%

  return (
    <div
      className={cn(
        "absolute m-0.5 flex min-h-16 flex-col items-start justify-start rounded border-2 border-transparent p-2",
        "cursor-pointer overflow-hidden transition-all duration-500 ease-in",
        bgColor,
        hoverColor,
        isFlexOrPaused &&
          "animate-pulse bg-gradient-to-br from-gray-400/70 via-gray-500/70 to-gray-400/70 bg-[length:20px_20px]",
        isCurrentlyAiring && "ring-opacity-60 ring-2 ring-green-400",
        program.type === "flex" && "cursor-default",
        className,
      )}
      style={{ left, width }}
      onClick={handleClick}
    >
      {/* Show Title */}
      <div className="w-full text-sm leading-tight font-semibold text-white drop-shadow-sm">
        {program.grandparentTitle ?? program.title}
      </div>

      {/* Season and Episode */}
      {(program.parentIndex != null || program.index != null) && (
        <div className="w-full text-xs leading-tight text-white/90 drop-shadow-sm">
          {program.parentIndex != null && `S${program.parentIndex}`}
          {program.parentIndex != null && program.index != null && " · "}
          {program.index != null && `E${program.index}`}
        </div>
      )}

      {/* Live Indicator */}
      {isCurrentlyAiring && (
        <div className="absolute top-1 right-1 rounded bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
          LIVE
        </div>
      )}
    </div>
  );
}

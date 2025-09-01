import { cn } from "~/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
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
  channelIndex,
  onClick,
  className,
}: TvGuideItemProps) {
  // Use both channel index and program index to create color variation
  const colorIndex = (channelIndex + index) % programColors.length;
  const colorClass = programColors[colorIndex];

  // Check if this is a very short program (less than 2% width)
  const widthNumber = parseFloat(width);
  const isVeryShort = widthNumber < 2;

  const handleClick = () => {
    if (onClick) {
      onClick(program);
    }
  };

  // Create tooltip content with full title and episode info
  const tooltipContent = () => {
    const mainTitle = program.grandparentTitle ?? program.title;
    const episodeTitle = program.title !== mainTitle ? program.title : null;
    const seasonEpisode =
      program.parentIndex != null || program.index != null
        ? `${program.parentIndex != null ? `S${program.parentIndex}` : ""}${program.parentIndex != null && program.index != null ? " · " : ""}${program.index != null ? `E${program.index}` : ""}`
        : null;

    return (
      <div className="space-y-1">
        <div className="font-semibold">{mainTitle}</div>
        {episodeTitle && <div className="text-sm">{episodeTitle}</div>}
        {seasonEpisode && (
          <div className="text-muted-foreground text-xs">{seasonEpisode}</div>
        )}
        {program.summary && (
          <div className="text-muted-foreground max-w-xs text-xs">
            {program.summary.length > 100
              ? `${program.summary.substring(0, 100)}...`
              : program.summary}
          </div>
        )}
      </div>
    );
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "border-card absolute flex min-h-16 flex-col items-start justify-start rounded-md border-2",
              "cursor-pointer overflow-hidden transition-all duration-500 ease-in",
              colorClass,
              // Use minimal spacing for very short programs to prevent overlap
              isVeryShort ? "m-0 p-1" : "m-0.5 p-2",
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
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          {tooltipContent()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { TvGuideItemProps } from "~/types/tv-guide";

interface CursorTooltipProps {
  isHovered: boolean;
  isVeryWide: boolean;
  mousePosition: { x: number; y: number };
  windowDimensions: { width: number; height: number };
  children: React.ReactNode;
}

function CursorTooltip({
  isHovered,
  isVeryWide,
  mousePosition,
  windowDimensions,
  children,
}: CursorTooltipProps) {
  if (!isHovered || !isVeryWide || windowDimensions.width === 0) return null;

  // Calculate position to avoid going off-screen
  const tooltipWidth = 320; // Approximate max width
  const tooltipHeight = 120; // Approximate height
  const offset = 10;

  let left = mousePosition.x + offset;
  let top = mousePosition.y - offset;

  // Adjust horizontal position if tooltip would go off-screen
  if (left + tooltipWidth > windowDimensions.width) {
    left = mousePosition.x - tooltipWidth - offset;
  }

  // Adjust vertical position if tooltip would go off-screen
  if (top - tooltipHeight < 0) {
    top = mousePosition.y + offset;
  }

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left,
        top,
        transform: top < mousePosition.y ? "translateY(-100%)" : "none",
      }}
    >
      <div className="bg-popover text-popover-foreground max-w-sm rounded-md border p-3 shadow-md">
        {children}
      </div>
    </div>
  );
}

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
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [windowDimensions, setWindowDimensions] = useState({
    width: 0,
    height: 0,
  });

  // Use both channel index and program index to create color variation
  const colorIndex = (channelIndex + index) % programColors.length;
  const colorClass = programColors[colorIndex];

  // Check if this is a very short program (less than 2% width)
  const widthNumber = parseFloat(width);
  const isVeryShort = widthNumber < 2;

  // Check if this is a very wide program (more than 50% width) - use cursor-based tooltip
  const isVeryWide = widthNumber > 50;
  const hasParentIndex =
    program.parentIndex !== null && program.parentIndex !== undefined;
  const hasEpisodeIndex = program.index !== null && program.index !== undefined;

  // Initialize window dimensions on mount
  useEffect(() => {
    const updateWindowDimensions = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateWindowDimensions();
    window.addEventListener("resize", updateWindowDimensions);
    return () => window.removeEventListener("resize", updateWindowDimensions);
  }, []);

  const handleClick = () => {
    if (onClick) {
      onClick(program);
    }
  };

  // Debounced mouse move handler to improve performance
  const handleMouseMove = (event: React.MouseEvent) => {
    if (isVeryWide) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  // Create tooltip content with full title and episode info
  const tooltipContent = () => {
    const mainTitle =
      program.grandparentTitle ?? program.title ?? "Unknown Program";
    const episodeTitle =
      program.title && program.title !== mainTitle ? program.title : null;
    const seasonEpisode =
      hasParentIndex || hasEpisodeIndex
        ? `${hasParentIndex ? `S${program.parentIndex}` : ""}${hasParentIndex && hasEpisodeIndex ? " · " : ""}${hasEpisodeIndex ? `E${program.index}` : ""}`
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
    <>
      {isVeryWide ? (
        // Use custom cursor-based tooltip for wide programs
        <button
          type="button"
          aria-label={program.grandparentTitle ?? program.title ?? "Program"}
          className={cn(
            "border-card absolute flex min-h-16 flex-col items-start justify-start rounded-md border-2",
            "cursor-pointer overflow-hidden transition-colors duration-200 ease-out",
            colorClass,
            // Use minimal spacing for very short programs to prevent overlap
            isVeryShort ? "m-0 p-1" : "m-0.5 p-2",
            className,
          )}
          style={{ left, width }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Show Title */}
          <div className="w-full text-sm leading-tight font-semibold text-nowrap text-white drop-shadow-sm">
            {program.grandparentTitle ?? program.title ?? "Unknown Program"}
          </div>

          {/* Season and Episode */}
          {(hasParentIndex || hasEpisodeIndex) && (
            <div className="w-full text-xs leading-tight text-nowrap text-white/90 drop-shadow-sm">
              {hasParentIndex && `S${program.parentIndex}`}
              {hasParentIndex && hasEpisodeIndex && " · "}
              {hasEpisodeIndex && `E${program.index}`}
            </div>
          )}
        </button>
      ) : (
        // Use standard tooltip for normal-width programs
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={
                  program.grandparentTitle ?? program.title ?? "Program"
                }
                className={cn(
                  "border-card absolute flex min-h-16 flex-col items-start justify-start rounded-md border-2",
                  "cursor-pointer overflow-hidden transition-colors duration-200 ease-out",
                  colorClass,
                  // Use minimal spacing for very short programs to prevent overlap
                  isVeryShort ? "m-0 p-1" : "m-0.5 p-2",
                  className,
                )}
                style={{ left, width }}
                onClick={handleClick}
              />
            }
          >
            {/* Show Title */}
            <div className="w-full text-sm leading-tight font-semibold text-nowrap text-white drop-shadow-sm">
              {program.grandparentTitle ?? program.title ?? "Unknown Program"}
            </div>

            {/* Season and Episode */}
            {(hasParentIndex || hasEpisodeIndex) && (
              <div className="w-full text-xs leading-tight text-nowrap text-white/90 drop-shadow-sm">
                {hasParentIndex && `S${program.parentIndex}`}
                {hasParentIndex && hasEpisodeIndex && " · "}
                {hasEpisodeIndex && `E${program.index}`}
              </div>
            )}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            {tooltipContent()}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Render cursor tooltip for wide programs */}
      <CursorTooltip
        isHovered={isHovered}
        isVeryWide={isVeryWide}
        mousePosition={mousePosition}
        windowDimensions={windowDimensions}
      >
        {tooltipContent()}
      </CursorTooltip>
    </>
  );
}

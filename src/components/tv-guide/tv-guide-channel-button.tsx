import Image from "next/image";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { TvGuideChannelButtonProps } from "~/types/tv-guide";

export function TvGuideChannelButton({
  channel,
  isCompact = false,
  onClick,
}: TvGuideChannelButtonProps) {
  const handleClick = () => {
    if (onClick) {
      onClick(channel);
    }
  };

  const displayTitle = channel.title.replace(channel.vcn, "").trim();

  return (
    <div className="flex min-h-16 flex-grow">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "h-full w-full justify-start rounded-none border-0 p-2 text-left",
                "hover:bg-muted/50 transition-colors duration-200",
              )}
              onClick={handleClick}
            >
              {/* Channel Icon/Logo */}
              <div className="mr-3 h-10 w-10 flex-shrink-0">
                {channel.thumb ? (
                  <Image
                    src={channel.thumb}
                    alt={channel.title}
                    width={40}
                    height={40}
                    className="h-full w-full rounded object-contain"
                    onError={(e) => {
                      // Fallback to a placeholder if image fails to load
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center rounded text-lg font-bold">
                    {channel.vcn}
                  </div>
                )}
              </div>

              {/* Channel Name/Number */}
              <div className="min-w-0 flex-grow">
                <div className="truncate text-sm font-medium">
                  {isCompact ? channel.vcn : channel.title}
                </div>
                {!isCompact && (
                  <div className="text-muted-foreground truncate text-xs">
                    Channel {channel.vcn}
                  </div>
                )}
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <div className="space-y-1">
              <div className="font-semibold">{displayTitle}</div>
              <div className="text-muted-foreground text-xs">
                Channel {channel.vcn}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

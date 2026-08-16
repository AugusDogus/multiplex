"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { TvGuideProgram, TvGuideChannelLineup } from "~/types/tv-guide";
import { TvGuideChannelButton } from "./tv-guide-channel-button";
import { TvGuideItem } from "./tv-guide-item";

function calculateTimeSlots(startTime: Date, endTime: Date) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

  // Use 30-minute increments for shorter durations, 60-minute for longer
  const increment = totalMinutes < 4 * 60 ? 30 : 60;
  const slotCount = Math.floor(totalMinutes / increment);

  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    const slotTime = new Date(start.getTime() + i * increment * 60 * 1000);
    slots.push({
      time: slotTime,
      increment,
      index: i,
    });
  }

  return { slots, slotCount, increment };
}

function formatTimeSlot(
  time: Date,
  isCompact: boolean,
  timeZone: string,
): string {
  if (isCompact) {
    return time.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  }
  return time.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
}

function calculateProgramPosition(
  program: TvGuideProgram,
  startTime: Date,
  endTime: Date,
) {
  const timelineDuration = endTime.getTime() - startTime.getTime();

  // Get timing from Media array
  const programStartTime = program.Media[0]?.beginsAt ?? 0;
  const programEndTime = program.Media[0]?.endsAt ?? 0;

  const programStart = new Date(programStartTime * 1000);
  const programEnd = new Date(programEndTime * 1000);

  // Calculate the visible portion of the program within the timeline
  const visibleStart = Math.max(programStart.getTime(), startTime.getTime());
  const visibleEnd = Math.min(programEnd.getTime(), endTime.getTime());

  // Skip programs that don't overlap with timeline
  if (visibleStart >= visibleEnd) {
    return { left: "0%", width: "0%" };
  }

  // Calculate position (left offset) as percentage of timeline
  const leftOffset =
    ((visibleStart - startTime.getTime()) / timelineDuration) * 100;

  // Calculate width as percentage of timeline
  const width = ((visibleEnd - visibleStart) / timelineDuration) * 100;

  return {
    left: `${Math.max(0, leftOffset)}%`,
    width: `${Math.max(0, width)}%`, // No minimum width - let very short programs be naturally small
  };
}

function renderChannelPrograms(
  lineup: TvGuideChannelLineup,
  startTime: Date,
  endTime: Date,
  channelIndex: number,
  onProgramClick?: (program: TvGuideProgram) => void,
) {
  const { programs } = lineup;

  if (programs.length === 0) {
    return (
      <div className="bg-muted/50 text-muted-foreground m-0.5 flex min-h-16 items-center justify-center rounded text-sm">
        No programming scheduled
      </div>
    );
  }

  return (
    <div className="relative min-h-16 w-full">
      {programs.map((program, index) => {
        const { left, width } = calculateProgramPosition(
          program,
          startTime,
          endTime,
        );

        const programStartTime = program.Media[0]?.beginsAt ?? 0;
        const programEndTime = program.Media[0]?.endsAt ?? 0;

        // Skip programs that are too small to be meaningful (less than 0.3% width)
        const widthNumber = parseFloat(width);
        if (widthNumber < 0.3) {
          return null;
        }

        return (
          <TvGuideItem
            key={`${program.ratingKey}_${programStartTime}_${programEndTime}`}
            program={program}
            width={width}
            left={left}
            index={index}
            channelIndex={channelIndex}
            onClick={onProgramClick}
          />
        );
      })}
    </div>
  );
}

function calculateCurrentTimeProgress(startTime: Date, endTime: Date): number {
  const now = new Date();
  if (now < startTime || now > endTime) {
    return -1; // Not within range
  }

  const total = endTime.getTime() - startTime.getTime();
  const elapsed = now.getTime() - startTime.getTime();
  return (elapsed / total) * 100;
}

function subscribeToTimeZone(onStoreChange: () => void) {
  const timeout = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timeout);
}

function getTimeZoneSnapshot() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getTimeZoneServerSnapshot() {
  return "UTC";
}

interface TvGuideProps {
  startTime: Date;
  endTime: Date;
  channelLineups: TvGuideChannelLineup[];
  isLoading?: boolean;
  error?: string;
}

function handleProgramClick(program: TvGuideProgram) {
  // TODO: Open program details modal
  console.log("Program clicked:", program);
}

function handleChannelClick(channel: TvGuideChannelLineup["channel"]) {
  // TODO: Open channel menu
  console.log("Channel clicked:", channel);
}

export function TvGuide({
  startTime,
  endTime,
  channelLineups,
  isLoading = false,
  error,
}: TvGuideProps) {
  const [isCompact, setIsCompact] = useState(false);
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    getTimeZoneSnapshot,
    getTimeZoneServerSnapshot,
  );
  const [currentTimeProgress, setCurrentTimeProgress] = useState(() =>
    calculateCurrentTimeProgress(startTime, endTime),
  );
  const [currentTimeLabel, setCurrentTimeLabel] = useState(() =>
    new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }),
  );

  // Detect mobile viewport for responsive design
  useEffect(() => {
    const checkViewport = () => {
      setIsCompact(window.innerWidth < 768); // md breakpoint
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  // Update current time indicator every minute
  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTimeProgress(calculateCurrentTimeProgress(startTime, endTime));
      setCurrentTimeLabel(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
        }),
      );
    };

    const initialUpdate = window.setTimeout(updateCurrentTime, 0);
    const interval = setInterval(updateCurrentTime, 60000); // Update every minute
    return () => {
      window.clearTimeout(initialUpdate);
      clearInterval(interval);
    };
  }, [startTime, endTime, timeZone]);

  // Time header component logic
  const { slots, slotCount } = calculateTimeSlots(startTime, endTime);
  const slotWidth = `${100 / slotCount}%`;

  if (error) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-destructive">Error loading TV guide: {error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="relative p-0">
        <div className="flex">
          {/* Channel Sidebar */}
          <div
            className={cn(
              "bg-muted/20 flex flex-col border-r",
              isCompact ? "w-20" : "w-48",
            )}
          >
            {/* Empty space above channels to align with time header */}
            <div className="flex h-8 items-center justify-center">Today</div>

            {/* Channel Buttons */}
            {channelLineups.map((lineup) => (
              <TvGuideChannelButton
                key={lineup.channel.id}
                channel={lineup.channel}
                isCompact={isCompact}
                onClick={handleChannelClick}
              />
            ))}
          </div>

          {/* Main Guide Area */}
          <div className="flex-1 overflow-x-clip">
            <div className="relative min-w-full">
              {/* Time Header */}
              <div className="flex h-8">
                {slots.map((slot) => (
                  <div
                    key={slot.index}
                    className="border-card flex items-center justify-center border-l text-center text-sm font-medium last:border-r"
                    style={{ width: slotWidth }}
                  >
                    {formatTimeSlot(slot.time, isCompact, timeZone)}
                  </div>
                ))}
              </div>

              {/* Program Grid */}
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                  <span>Loading TV guide...</span>
                </div>
              ) : (
                <div className="mb-1 space-y-0">
                  {channelLineups.map((lineup, channelIndex) => (
                    <div key={lineup.channel.id} className="flex">
                      {renderChannelPrograms(
                        lineup,
                        startTime,
                        endTime,
                        channelIndex,
                        handleProgramClick,
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Current Time Indicator */}
        {currentTimeProgress >= 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 top-0 right-0 z-20"
              style={{ left: isCompact ? "5rem" : "12rem" }}
              suppressHydrationWarning
            >
              <div
                className="absolute inset-0 transition-transform duration-500 ease-linear"
                style={{
                  transform: `translateX(${currentTimeProgress}%)`,
                }}
                suppressHydrationWarning
              >
                <div
                  suppressHydrationWarning
                  className="bg-primary text-primary-foreground absolute top-0 left-0 min-w-12 -translate-x-1/2 translate-y-1/4 rounded px-2 py-1 text-center text-xs"
                >
                  {currentTimeLabel}
                </div>
                <div className="bg-primary absolute top-7 bottom-1 left-0 w-0.5" />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

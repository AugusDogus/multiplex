"use client";

import { useMemo } from "react";
import { api } from "~/trpc/react";
import { convertApiDataToTvGuide } from "~/types/tv-guide";
import { TvGuide } from "./tv-guide";

interface TvGuideWrapperProps {
  date?: string; // YYYY-MM-DD format, defaults to today
  durationHours?: number; // How many hours to show, defaults to 4
}

export function TvGuideWrapper({
  date,
  durationHours = 4,
}: TvGuideWrapperProps) {
  // Default to today if no date provided
  const targetDate = date ?? new Date().toISOString().substring(0, 10);

  // Calculate time range
  const { startTime, endTime } = useMemo(() => {
    const start = new Date(targetDate);
    // Start at current hour if today, otherwise start at midnight
    if (targetDate === new Date().toISOString().substring(0, 10)) {
      start.setHours(new Date().getHours(), 0, 0, 0);
    } else {
      start.setHours(0, 0, 0, 0);
    }

    const end = new Date(start);
    end.setHours(start.getHours() + durationHours);

    return { startTime: start, endTime: end };
  }, [targetDate, durationHours]);

  // Fetch channel programming data
  const {
    data: channelsProgramming,
    isLoading,
    error,
  } = api.plex.getAllChannelsProgramming.useQuery({
    date: targetDate,
  });

  // Convert API data to TV guide format
  const channelLineups = useMemo(() => {
    if (!channelsProgramming) return [];

    return convertApiDataToTvGuide(channelsProgramming, startTime, endTime);
  }, [channelsProgramming, startTime, endTime]);

  return (
    <div className="w-full">
      <TvGuide
        startTime={startTime}
        endTime={endTime}
        channelLineups={channelLineups}
        isLoading={isLoading}
        error={error?.message}
      />
    </div>
  );
}

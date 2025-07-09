import type { AllChannelsProgrammingResult } from "~/server/queries/get-all-channels-programming";

/* ────────────────────────────────────────────────────────────
   TV Guide Types
   TypeScript types for TV guide components using AllChannelsProgrammingResult
   ──────────────────────────────────────────────────────────── */

// Use types directly from AllChannelsProgrammingResult
export type TvGuideChannel = AllChannelsProgrammingResult['channels'][0];
export type TvGuideProgram = AllChannelsProgrammingResult['programming'][0]['data']['programs'][0] & {
  // Add some additional fields for TV guide functionality
  isPaused?: boolean;
  timeRemaining?: number;
};
export type TvGuideProgramming = AllChannelsProgrammingResult['programming'][0];

// Channel lineup with programs - adapts the API structure for UI consumption
export interface TvGuideChannelLineup {
  channel: TvGuideChannel;
  programs: TvGuideProgram[];
}

// Props for the main TV guide component
export interface TvGuideProps {
  startTime: Date;
  endTime: Date;
  channelLineups: TvGuideChannelLineup[];
  isLoading?: boolean;
  error?: string;
}

// Props for individual guide items
export interface TvGuideItemProps {
  program: TvGuideProgram;
  width: string;
  left: string;
  index: number;
  onClick?: (program: TvGuideProgram) => void;
  className?: string;
}

// Props for channel buttons in sidebar
export interface TvGuideChannelButtonProps {
  channel: TvGuideChannel;
  isCompact?: boolean;
  onClick?: (channel: TvGuideChannel) => void;
}

// Time slot information for header
export interface TvGuideTimeSlot {
  time: Date;
  label: string;
  width: string;
}

// Utility function to convert our API data to TV guide format
export function convertApiDataToTvGuide(
  data: AllChannelsProgrammingResult,
  startTime: Date,
  endTime: Date,
): TvGuideChannelLineup[] {
  const channelLineups: TvGuideChannelLineup[] = [];

  const startTimeUnix = Math.floor(startTime.getTime() / 1000);
  const endTimeUnix = Math.floor(endTime.getTime() / 1000);

  // Group channels and their programming
  for (const channel of data.channels) {
    const programming = data.programming.find(p => p.gridKey === channel.gridKey);
    
    // Filter programs to only include those that overlap with our time window
    const allPrograms = programming?.data.programs ?? [];
    const filteredPrograms = allPrograms.filter(program => {
      const programStart = program.Media[0]?.beginsAt ?? 0;
      const programEnd = program.Media[0]?.endsAt ?? 0;
      
      // Include program if it overlaps with our time window
      return programEnd > startTimeUnix && programStart < endTimeUnix;
    });

    // Add our additional fields
    const programs: TvGuideProgram[] = filteredPrograms.map(program => ({
      ...program,
      isPaused: false,
      timeRemaining: undefined,
    }));

    channelLineups.push({
      channel: channel,
      programs: programs,
    });
  }

  return channelLineups;
} 
import type { AllChannelsProgrammingResult } from "~/server/queries/get-all-channels-programming";

/* ────────────────────────────────────────────────────────────
   TV Guide Types
   TypeScript types for TV guide components using AllChannelsProgrammingResult
   ──────────────────────────────────────────────────────────── */

// Use types directly from AllChannelsProgrammingResult (now ChannelLineup[])
export type TvGuideChannelLineup = AllChannelsProgrammingResult[0];
export type TvGuideChannel = TvGuideChannelLineup['channel'];
export type TvGuideProgram = TvGuideChannelLineup['programs'][0];

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
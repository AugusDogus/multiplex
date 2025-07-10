import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";
import { getServersQuery } from "./get-servers";

export type ChannelLineup = {
  channel: {
    id: string;
    gridKey: string;
    vcn: string;
    thumb: string;
    title: string;
    callSign: string;
  };
  programs: Array<{
    ratingKey: string;
    key: string;
    title: string;
    summary?: string;
    duration: number;
    addedAt: number;
    onAir?: boolean;
    type: string;
    grandparentTitle?: string;
    parentTitle?: string;
    index?: number;
    parentIndex?: number;
    Media: Array<{
      id: number;
      duration: number;
      audioChannels: number;
      videoResolution: string;
      channelCallSign: string;
      channelIdentifier: string;
      channelThumb: string;
      channelTitle: string;
      channelVcn: string;
      protocol: string;
      beginsAt: number;
      endsAt: number;
      channelID: number;
      onAir?: boolean;
    }>;
    Image?: Array<{
      alt: string;
      type: string;
      url: string;
    }>;
    Channel?: Array<{
      id: number;
      filter: string;
      tag: string;
    }>;
  }>;
};

export type AllChannelsProgrammingResult = ChannelLineup[];

async function getChannelsProgrammingData(
  plex: PlexTvClient,
  date: string,
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  const servers = await getServersQuery(plex);
  const channelLineups: ChannelLineup[] = [];
  const processedGridKeys = new Set<string>();

  // Convert time filters to Unix timestamps if provided
  // Note: Date.getTime() already returns UTC milliseconds, so we just divide by 1000
  const startTimeUnix = startTime ? Math.floor(startTime.getTime() / 1000) : undefined;
  const endTimeUnix = endTime ? Math.floor(endTime.getTime() / 1000) : undefined;

  // Get channels from all servers
  for (const server of servers) {
    const serverClient = plex.createServerClient(server);
    
    try {
      const channelsResponse = await serverClient.getChannels();
      
      // Process each channel
      for (const channel of channelsResponse.MediaContainer.Channel) {
        // Skip if we've already processed this gridKey globally
        if (processedGridKeys.has(channel.gridKey)) {
          continue;
        }

        try {
          const gridResponse = await serverClient.getGrid({
            channelGridKey: channel.gridKey,
            date: date,
          });

          // Filter programs by time window if specified
          const allPrograms = (gridResponse.MediaContainer.Metadata ?? []).map(metadata => ({
            ratingKey: metadata.ratingKey,
            key: metadata.key,
            title: metadata.title,
            summary: metadata.summary,
            duration: metadata.duration,
            addedAt: metadata.addedAt,
            onAir: metadata.onAir,
            type: metadata.type,
            grandparentTitle: metadata.grandparentTitle,
            parentTitle: metadata.parentTitle,
            index: metadata.index,
            parentIndex: metadata.parentIndex,
            Media: metadata.Media.map(media => ({
              id: media.id,
              duration: media.duration,
              audioChannels: media.audioChannels,
              videoResolution: media.videoResolution,
              channelCallSign: media.channelCallSign,
              channelIdentifier: media.channelIdentifier,
              channelThumb: media.channelThumb,
              channelTitle: media.channelTitle,
              channelVcn: media.channelVcn,
              protocol: media.protocol,
              beginsAt: media.beginsAt,
              endsAt: media.endsAt,
              channelID: media.channelID,
              onAir: media.onAir,
            })),
            Image: metadata.Image?.map(image => ({
              alt: image.alt,
              type: image.type,
              url: image.url,
            })),
            Channel: metadata.Channel?.map(channel => ({
              id: channel.id,
              filter: channel.filter,
              tag: channel.tag,
            })),
          }));

          // Apply time filtering if specified
          const filteredPrograms = (startTimeUnix && endTimeUnix) ? allPrograms.filter(program => {
            const programStart = program.Media[0]?.beginsAt ?? 0;
            const programEnd = program.Media[0]?.endsAt ?? 0;
            
            // Include program if it overlaps with our time window
            return programEnd > startTimeUnix && programStart < endTimeUnix;
          }) : allPrograms;

          channelLineups.push({
            channel: {
              id: channel.id,
              gridKey: channel.gridKey,
              vcn: channel.vcn,
              thumb: channel.thumb,
              title: channel.title,
              callSign: channel.callSign,
            },
            programs: filteredPrograms,
          });

          processedGridKeys.add(channel.gridKey);
        } catch (error) {
          console.warn(`Failed to get grid data for gridKey ${channel.gridKey} on server ${server.name}:`, error);
          // Add channel with empty programs if grid data fails
          channelLineups.push({
            channel: {
              id: channel.id,
              gridKey: channel.gridKey,
              vcn: channel.vcn,
              thumb: channel.thumb,
              title: channel.title,
              callSign: channel.callSign,
            },
            programs: [],
          });
          processedGridKeys.add(channel.gridKey);
        }
      }
    } catch (error) {
      console.warn(`Failed to get channels from server ${server.name}:`, error);
    }
  }

  return channelLineups;
}

function getRequiredDates(date: string, startTime?: Date, endTime?: Date): string[] {
  const dates = [date];

  if (startTime && endTime) {
    // Check if the time window crosses into the next day in UTC
    // Since Date.getTime() returns UTC milliseconds, we can directly create UTC dates
    const startDateUTC = new Date(startTime.getTime());
    const endDateUTC = new Date(endTime.getTime());
    
    if (endDateUTC.getUTCDate() !== startDateUTC.getUTCDate() || 
        endDateUTC.getUTCMonth() !== startDateUTC.getUTCMonth() ||
        endDateUTC.getUTCFullYear() !== startDateUTC.getUTCFullYear()) {
      
      // Calculate the next day
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayString = nextDay.toISOString().substring(0, 10);
      
      if (!dates.includes(nextDayString)) {
        dates.push(nextDayString);
      }
    }
  }

  return dates;
}

async function mergeChannelLineups(lineups: AllChannelsProgrammingResult[]): Promise<AllChannelsProgrammingResult> {
  const mergedMap = new Map<string, ChannelLineup>();

  for (const lineup of lineups) {
    for (const channelLineup of lineup) {
      const existing = mergedMap.get(channelLineup.channel.gridKey);
      
      if (existing) {
        // Merge programs, avoiding duplicates by ratingKey
        const existingPrograms = new Set(existing.programs.map(p => p.ratingKey));
        const newPrograms = channelLineup.programs.filter(p => !existingPrograms.has(p.ratingKey));
        
        existing.programs = [...existing.programs, ...newPrograms];
        
        // Sort programs by start time
        existing.programs.sort((a, b) => {
          const aStart = a.Media[0]?.beginsAt ?? 0;
          const bStart = b.Media[0]?.beginsAt ?? 0;
          return aStart - bStart;
        });
      } else {
        mergedMap.set(channelLineup.channel.gridKey, {
          channel: channelLineup.channel,
          programs: [...channelLineup.programs],
        });
      }
    }
  }

  return Array.from(mergedMap.values());
}

export async function getAllChannelsProgrammingQuery(
  plex: PlexTvClient,
  date: string,
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  // Determine which dates we need to fetch
  const requiredDates = getRequiredDates(date, startTime, endTime);
  
  // First attempt to get programming data for all required dates
  const lineupPromises = requiredDates.map(dateStr => 
    getChannelsProgrammingData(plex, dateStr, startTime, endTime)
  );
  
  let allLineups = await Promise.all(lineupPromises);
  let channelLineups = await mergeChannelLineups(allLineups);

  // Check if we got any programming data
  const hasAnyPrograms = channelLineups.some(lineup => lineup.programs.length > 0);

  if (!hasAnyPrograms && channelLineups.length > 0) {
    // Try to reload guide on all servers that have EPG capabilities
    const servers = await getServersQuery(plex);
    const reloadPromises = servers.map(async (server) => {
      try {
        const serverClient = plex.createServerClient(server);
        await serverClient.reloadGuide();
      } catch (error) {
        console.warn(`Failed to reload guide for server ${server.name}:`, error);
      }
    });

    // Wait for all reload attempts to complete
    await Promise.allSettled(reloadPromises);

    // Give it a moment for the guide to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to get programming data again for all required dates
    const retryLineupPromises = requiredDates.map(dateStr => 
      getChannelsProgrammingData(plex, dateStr, startTime, endTime)
    );
    
    allLineups = await Promise.all(retryLineupPromises);
    channelLineups = await mergeChannelLineups(allLineups);
  }

  return channelLineups;
} 
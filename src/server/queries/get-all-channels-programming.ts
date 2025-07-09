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

export async function getAllChannelsProgrammingQuery(
  plex: PlexTvClient,
  date: string,
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  const servers = await getServersQuery(plex);
  const channelLineups: ChannelLineup[] = [];
  const processedGridKeys = new Set<string>();

  // Convert time filters to Unix timestamps if provided
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
          const allPrograms = gridResponse.MediaContainer.Metadata.map(metadata => ({
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
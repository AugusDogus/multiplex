import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";
import { getServersQuery } from "./get-servers";

export type AllChannelsProgrammingResult = {
  channels: Array<{
    id: string;
    gridKey: string;
    vcn: string;
    thumb: string;
    title: string;
    callSign: string;
  }>;
  programming: Array<{
    gridKey: string;
    serverId: string;
    serverName: string;
    data: {
      size: number;
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
  }>;
};

export async function getAllChannelsProgrammingQuery(
  plex: PlexTvClient,
  date: string,
): Promise<AllChannelsProgrammingResult> {
  const servers = await getServersQuery(plex);
  const allChannels: AllChannelsProgrammingResult["channels"] = [];
  const allProgramming: AllChannelsProgrammingResult["programming"] = [];
  const processedGridKeys = new Set<string>();

  // Get channels from all servers
  for (const server of servers) {
    const serverClient = plex.createServerClient(server);
    
    try {
      const channelsResponse = await serverClient.getChannels();
      
      // Add channels to the result
      for (const channel of channelsResponse.MediaContainer.Channel) {
        allChannels.push({
          id: channel.id,
          gridKey: channel.gridKey,
          vcn: channel.vcn,
          thumb: channel.thumb,
          title: channel.title,
          callSign: channel.callSign,
        });
      }

      // Collect unique gridKeys for this server
      const uniqueGridKeys = new Set(
        channelsResponse.MediaContainer.Channel.map(channel => channel.gridKey)
      );

      // Get programming data for each unique gridKey
      for (const gridKey of uniqueGridKeys) {
        // Skip if we've already processed this gridKey globally
        if (processedGridKeys.has(gridKey)) {
          continue;
        }

        try {
          const gridResponse = await serverClient.getGrid({
            channelGridKey: gridKey,
            date: date,
          });

          allProgramming.push({
            gridKey,
            serverId: server.clientIdentifier,
            serverName: server.name,
            data: {
              size: gridResponse.MediaContainer.size,
              programs: gridResponse.MediaContainer.Metadata.map(metadata => ({
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
              })),
            },
          });

          processedGridKeys.add(gridKey);
        } catch (error) {
          console.warn(`Failed to get grid data for gridKey ${gridKey} on server ${server.name}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to get channels from server ${server.name}:`, error);
    }
  }

  return {
    channels: allChannels,
    programming: allProgramming,
  };
} 
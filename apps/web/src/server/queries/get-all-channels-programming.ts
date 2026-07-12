import type { PlexServerClient, PlexTvClient } from "@multiplex/plex-query";
import { getServersQuery } from "./get-servers";

/**
 * Extract DVR ID from provider identifier
 * Example: "tv.plex.providers.epg.xmltv:73" -> "73"
 */
function extractDvrIdFromProvider(providerIdentifier: string): string | null {
  const match = /:(\d+)$/.exec(providerIdentifier);
  return match?.[1] ?? null;
}

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
    duration?: number;
    addedAt: number;
    onAir?: boolean;
    type: string;
    grandparentTitle?: string;
    parentTitle?: string;
    index?: number;
    parentIndex?: number;
    Media: Array<{
      id: number;
      duration?: number;
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
  const processedGridKeys = new Set<string>();

  // Convert time filters to Unix timestamps if provided
  // Note: Date.getTime() already returns UTC milliseconds, so we just divide by 1000
  const startTimeUnix = startTime
    ? Math.floor(startTime.getTime() / 1000)
    : undefined;
  const endTimeUnix = endTime
    ? Math.floor(endTime.getTime() / 1000)
    : undefined;

  const availableChannels = (
    await Promise.all(
      servers.map(async (server) => {
        const serverClient = plex.createServerClient(server);

        try {
          const channelsResponse = await serverClient.getChannels();
          return channelsResponse.MediaContainer.Channel.map((channel) => ({
            channel,
            server,
            serverClient,
          }));
        } catch (error) {
          console.warn(
            `Failed to get channels from server ${server.name}:`,
            error,
          );
          return [];
        }
      }),
    )
  ).flat();

  // Claim duplicate grid keys in server/channel order before starting the
  // concurrent requests, so global deduplication remains deterministic.
  const uniqueChannels = availableChannels.filter(({ channel }) => {
    if (processedGridKeys.has(channel.gridKey)) {
      return false;
    }

    processedGridKeys.add(channel.gridKey);
    return true;
  });

  const channelLineups = await Promise.all(
    uniqueChannels.map(async ({ channel, server, serverClient }) => {
      try {
        const gridResponse = await serverClient.getGrid({
          channelGridKey: channel.gridKey,
          date: date,
        });

        // Filter programs by time window if specified
        const allPrograms = (gridResponse.MediaContainer.Metadata ?? []).map(
          (metadata) => ({
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
            Media: metadata.Media.map((media) => ({
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
            Image: metadata.Image?.map((image) => ({
              alt: image.alt,
              type: image.type,
              url: image.url,
            })),
            Channel: metadata.Channel?.map((channel) => ({
              id: channel.id,
              filter: channel.filter,
              tag: channel.tag,
            })),
          }),
        );

        // Apply time filtering if specified
        const filteredPrograms =
          startTimeUnix && endTimeUnix
            ? allPrograms.filter((program) => {
                const programStart = program.Media[0]?.beginsAt ?? 0;
                const programEnd = program.Media[0]?.endsAt ?? 0;

                // Include program if it overlaps with our time window
                return programEnd > startTimeUnix && programStart < endTimeUnix;
              })
            : allPrograms;

        return {
          channel: {
            id: channel.id,
            gridKey: channel.gridKey,
            vcn: channel.vcn,
            thumb: channel.thumb,
            title: channel.title,
            callSign: channel.callSign,
          },
          programs: filteredPrograms,
        } satisfies ChannelLineup;
      } catch (error) {
        console.warn(
          `Failed to get grid data for gridKey ${channel.gridKey} on server ${server.name}:`,
          error,
        );
        // Add channel with empty programs if grid data fails
        return {
          channel: {
            id: channel.id,
            gridKey: channel.gridKey,
            vcn: channel.vcn,
            thumb: channel.thumb,
            title: channel.title,
            callSign: channel.callSign,
          },
          programs: [],
        } satisfies ChannelLineup;
      }
    }),
  );

  return channelLineups;
}

function getRequiredDates(
  date: string,
  startTime?: Date,
  endTime?: Date,
): string[] {
  const dates = [date];

  if (startTime && endTime) {
    // Check if the time window crosses into the next day in UTC
    // Since Date.getTime() returns UTC milliseconds, we can directly create UTC dates
    const startDateUTC = new Date(startTime.getTime());
    const endDateUTC = new Date(endTime.getTime());

    if (
      endDateUTC.getUTCDate() !== startDateUTC.getUTCDate() ||
      endDateUTC.getUTCMonth() !== startDateUTC.getUTCMonth() ||
      endDateUTC.getUTCFullYear() !== startDateUTC.getUTCFullYear()
    ) {
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

async function mergeChannelLineups(
  lineups: AllChannelsProgrammingResult[],
): Promise<AllChannelsProgrammingResult> {
  const mergedMap = new Map<string, ChannelLineup>();

  for (const lineup of lineups) {
    for (const channelLineup of lineup) {
      const existing = mergedMap.get(channelLineup.channel.gridKey);

      if (existing) {
        // Merge programs, avoiding duplicates by ratingKey
        const existingPrograms = new Set(
          existing.programs.map((p) => p.ratingKey),
        );
        const newPrograms = channelLineup.programs.filter(
          (p) => !existingPrograms.has(p.ratingKey),
        );

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
  const dates = getRequiredDates(date, startTime, endTime);

  const lineupPromises = dates.map(async (dateStr) => {
    return await getChannelsProgrammingData(plex, dateStr, startTime, endTime);
  });

  const lineupResults = await Promise.all(lineupPromises);

  if (lineupResults.length === 1) {
    return lineupResults[0]!;
  }

  // Merge lineups from multiple dates
  return await mergeChannelLineups(lineupResults);
}

/**
 * Get channels programming for a specific server
 * More efficient than getAllChannelsProgramming when targeting a single server
 */
export async function getServerChannelsProgrammingQuery(
  plex: PlexTvClient,
  machineIdentifier: string,
  providerIdentifier: string,
  date: string,
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  const servers = await getServersQuery(plex);
  const targetServer = servers.find(
    (server) => server.clientIdentifier === machineIdentifier,
  );

  if (!targetServer) {
    throw new Error(
      `Server with machineIdentifier ${machineIdentifier} not found`,
    );
  }

  const serverClient = plex.createServerClient(targetServer);
  const requiredDates = getRequiredDates(date, startTime, endTime);

  // First attempt to get programming data
  const initialChannelLineups = await fetchChannelLineupsForDates(
    serverClient,
    providerIdentifier,
    requiredDates,
    startTime,
    endTime,
  );

  // Check if we got any programming data
  const hasAnyPrograms = initialChannelLineups.some(
    (lineup) => lineup.programs.length > 0,
  );

  // If we have programs or no channels, return the initial data
  if (hasAnyPrograms || initialChannelLineups.length === 0) {
    return initialChannelLineups;
  }

  // No programming data but channels exist - try to reload guide
  console.log(
    `No programming data found for server ${targetServer.name}, attempting to reload guide...`,
  );

  try {
    // Extract DVR ID from provider identifier for targeted reload
    const dvrId = extractDvrIdFromProvider(providerIdentifier);

    if (dvrId) {
      console.log(`Reloading guide for specific DVR ID: ${dvrId}`);
      await serverClient.reloadGuide(dvrId);
      console.log(
        `Guide reloaded successfully for DVR ${dvrId} on server ${targetServer.name}`,
      );
    } else {
      console.log(
        `Could not extract DVR ID from provider identifier, falling back to reload all guides`,
      );
      await serverClient.reloadAllGuides();
      console.log(
        `All guides reloaded successfully for server ${targetServer.name}`,
      );
    }

    // Give it a moment for the guide to be processed
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Try to get programming data again
    return await fetchChannelLineupsForDates(
      serverClient,
      providerIdentifier,
      requiredDates,
      startTime,
      endTime,
    );
  } catch (error) {
    console.warn(
      `Failed to reload guide for server ${targetServer.name}:`,
      error,
    );
    return initialChannelLineups;
  }
}

/**
 * Helper function to fetch channel lineups for multiple dates
 */
async function fetchChannelLineupsForDates(
  serverClient: PlexServerClient,
  providerIdentifier: string,
  dates: string[],
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  const dateResults = await Promise.all(
    dates.map((dateStr) =>
      getServerChannelsProgrammingForDate(
        serverClient,
        providerIdentifier,
        dateStr,
        startTime,
        endTime,
      ),
    ),
  );

  if (dateResults.length === 1) {
    const singleResult = dateResults.at(0);
    if (!singleResult) {
      throw new Error("Expected single result but got undefined");
    }
    return singleResult;
  }

  return await mergeChannelLineups(dateResults);
}

/**
 * Get channels programming for a specific server and date
 * Helper function to fetch data for a single date
 */
async function getServerChannelsProgrammingForDate(
  serverClient: PlexServerClient,
  providerIdentifier: string,
  date: string,
  startTime?: Date,
  endTime?: Date,
): Promise<AllChannelsProgrammingResult> {
  const processedGridKeys = new Set<string>();

  // Convert time filters to Unix timestamps if provided
  const startTimeUnix = startTime
    ? Math.floor(startTime.getTime() / 1000)
    : undefined;
  const endTimeUnix = endTime
    ? Math.floor(endTime.getTime() / 1000)
    : undefined;

  try {
    const channelsResponse = await serverClient.getChannels(providerIdentifier);

    const uniqueChannels = channelsResponse.MediaContainer.Channel.filter(
      (channel) => {
        if (processedGridKeys.has(channel.gridKey)) {
          return false;
        }

        processedGridKeys.add(channel.gridKey);
        return true;
      },
    );

    const channelLineups = await Promise.all(
      uniqueChannels.map(async (channel) => {
        try {
          const gridResponse = await serverClient.getGrid({
            channelGridKey: channel.gridKey,
            date: date,
            providerIdentifier: providerIdentifier,
          });

          // Filter programs by time window if specified
          const allPrograms = (gridResponse.MediaContainer.Metadata ?? []).map(
            (metadata) => ({
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
              Media: metadata.Media.map((media) => ({
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
              Image: metadata.Image?.map((image) => ({
                alt: image.alt,
                type: image.type,
                url: image.url,
              })),
              Channel: metadata.Channel?.map((channel) => ({
                id: channel.id,
                filter: channel.filter,
                tag: channel.tag,
              })),
            }),
          );

          // Apply time filtering if specified
          const filteredPrograms =
            startTimeUnix && endTimeUnix
              ? allPrograms.filter((program) => {
                  const programStart = program.Media[0]?.beginsAt ?? 0;
                  const programEnd = program.Media[0]?.endsAt ?? 0;

                  // Include program if it overlaps with our time window
                  return (
                    programEnd > startTimeUnix && programStart < endTimeUnix
                  );
                })
              : allPrograms;

          return {
            channel: {
              id: channel.id,
              gridKey: channel.gridKey,
              vcn: channel.vcn,
              thumb: channel.thumb,
              title: channel.title,
              callSign: channel.callSign,
            },
            programs: filteredPrograms,
          } satisfies ChannelLineup;
        } catch (error) {
          console.warn(
            `Failed to get grid data for gridKey ${channel.gridKey} on ${date}:`,
            error,
          );
          // Add channel with empty programs if grid data fails
          return {
            channel: {
              id: channel.id,
              gridKey: channel.gridKey,
              vcn: channel.vcn,
              thumb: channel.thumb,
              title: channel.title,
              callSign: channel.callSign,
            },
            programs: [],
          } satisfies ChannelLineup;
        }
      }),
    );

    // Sort channel lineups by VCN (Virtual Channel Number)
    channelLineups.sort((a, b) => {
      const aVcn = parseFloat(a.channel.vcn) || 0;
      const bVcn = parseFloat(b.channel.vcn) || 0;
      return aVcn - bVcn;
    });

    return channelLineups;
  } catch (error) {
    console.warn(`Failed to get channels for ${date}:`, error);
    return [];
  }
}

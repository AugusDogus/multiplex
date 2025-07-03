import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";
import type { PlexDevice } from "~/lib/plex.tv/schemas/plex-tv-schemas";
import {
  isMetadataResult,
  isDirectoryResult,
  type SearchParams,
  type ProcessedSearchResult,
  type GroupedSearchResults,
} from "~/lib/plex.tv/schemas/search-schemas";

export async function searchQuery(
  plex: PlexTvClient,
  params: SearchParams,
): Promise<GroupedSearchResults> {
  try {
    // Get servers
    const servers = await plex.getServers();
    
    if (!servers || servers.length === 0) {
      return {
        movies: [],
        tv: [],
        music: [],
        people: [],
        collections: [],
        totalResults: 0,
      };
    }

    // Get user info for auth token fallback
    const userInfo = await plex.getUserInfo();
    
    // Helper function to get the best server URL (improved version)
    const getServerUrl = (server: PlexDevice): string | undefined => {
      const connections = Array.isArray(server.connections) ? server.connections : [];
      const PORT_REGEX = /:\d+(?=\/|$)/;
      
      const pick = (pred: (c: typeof connections[0]) => boolean) => connections.find(pred);

      // Prefer non-local plex.direct connections (public IPs work better through relay)
      const directNonLocal = pick(c => c?.uri?.startsWith("https://") && c.uri.includes(".plex.direct") && !c.local);
      const directLocal = pick(c => c?.uri?.startsWith("https://") && c.uri.includes(".plex.direct") && c.local);
      const customNP = pick(c => {
        const u = c?.uri;
        return u?.startsWith("https://") && !u.includes(".plex.direct") && !PORT_REGEX.test(u);
      });
      const httpsAny = pick(c => c?.uri?.startsWith("https://"));
      const anyConnection = pick(c => Boolean(c?.uri));

      const selected = directNonLocal?.uri ?? directLocal?.uri ?? customNP?.uri ?? httpsAny?.uri ?? anyConnection?.uri;
      if (!selected) return undefined;
      
      // Debug logging for problematic server
              if (selected.includes("192.168.1.69") || selected.includes(".plex.direct")) {
          console.log(`🔧 [ServerURL Debug] Server connections for ${server.name}:`, {
            allConnections: connections.map((c: PlexDevice['connections'][0]) => ({ uri: c?.uri, local: c?.local, relay: c?.relay })),
            directNonLocal: directNonLocal?.uri,
            directLocal: directLocal?.uri,
            customNP: customNP?.uri,
            httpsAny: httpsAny?.uri,
            anyConnection: anyConnection?.uri,
            selected,
            finalUrl: !selected.includes(".plex.direct") && PORT_REGEX.test(selected)
              ? selected.replace(PORT_REGEX, "")
              : selected
          });
        }
      
      return !selected.includes(".plex.direct") && PORT_REGEX.test(selected)
        ? selected.replace(PORT_REGEX, "")
        : selected;
    };

    // Search all servers in parallel
    const serverPromises = servers.map(async (server) => {
      try {
        const serverClient = plex.createServerClient(server);
        const response = await serverClient.search(params);
        
        // Get server connection info for images
        const serverUrl = getServerUrl(server);
        const authToken = server.accessToken ?? userInfo?.authToken;
        
        console.log(`🔍 [SearchQuery] Server ${server.name} connection info:`, {
          serverUrl,
          authToken: authToken ? `${authToken.substring(0, 10)}...` : 'none',
          connections: server.connections.map((conn: PlexDevice['connections'][0]) => ({ uri: conn.uri, local: conn.local, relay: conn.relay }))
        });
        
        const results: ProcessedSearchResult[] = [];
        const searchResults = Array.isArray(response.MediaContainer.SearchResult) 
          ? response.MediaContainer.SearchResult 
          : [];
        
        for (const rawResult of searchResults) {
          try {
            // Use proper type guards for union types
            if (isMetadataResult(rawResult)) {
              const metadata = rawResult.Metadata;
              results.push({
                ratingKey: metadata.ratingKey,
                key: metadata.key,
                guid: metadata.guid,
                type: metadata.type,
                title: metadata.title,
                summary: metadata.summary,
                year: metadata.year,
                thumb: metadata.thumb,
                art: metadata.art,
                duration: metadata.duration,
                studio: metadata.studio,
                contentRating: metadata.contentRating,
                rating: metadata.rating,
                score: rawResult.score,
                serverId: server.clientIdentifier,
                serverName: server.name,
                serverUrl,
                authToken,
                librarySection: metadata.librarySectionTitle,
                // TV Show specific fields
                parentTitle: metadata.parentTitle,
                grandparentTitle: metadata.grandparentTitle,
                seasonNumber: metadata.parentIndex,
                episodeNumber: metadata.index,
                // Music specific fields
                artistName: metadata.grandparentTitle,
                albumName: metadata.parentTitle,
              });
            } else if (isDirectoryResult(rawResult)) {
              const directory = rawResult.Directory;
              results.push({
                ratingKey: directory.id?.toString() ?? directory.tagKey ?? directory.key,
                key: directory.key,
                guid: directory.tagKey ?? directory.key,
                type: 'person',
                title: directory.tag,
                summary: `${directory.count ?? 0} appearances`,
                thumb: directory.thumb,
                score: rawResult.score,
                serverId: server.clientIdentifier,
                serverName: server.name,
                serverUrl,
                authToken,
                librarySection: directory.librarySectionTitle ?? 'People',
              });
            } else {
              console.warn(`🔍 [SearchQuery] Unhandled result type from ${server.name}:`, Object.keys(rawResult));
            }
          } catch (error) {
            console.warn(`🔍 [SearchQuery] Failed to process search result from ${server.name}:`, error);
          }
        }
        
        return results;
      } catch (error) {
        console.warn(`🔍 [SearchQuery] Search failed for server ${server.name}:`, error);
        return [];
      }
    });

    const serverResults = await Promise.allSettled(serverPromises);
    
    // Extract successful results
    const allResults = serverResults
      .filter((result): result is PromiseFulfilledResult<ProcessedSearchResult[]> => 
        result.status === 'fulfilled'
      )
      .flatMap(result => result.value);

    // Sort by relevance score
    allResults.sort((a, b) => b.score - a.score);
    
    // Group by media type
    return {
      movies: allResults.filter(result => result.type === 'movie'),
      tv: allResults.filter(result => 
        result.type === 'show' || result.type === 'episode'
      ),
      music: allResults.filter(result => 
        result.type === 'artist' || result.type === 'album' || result.type === 'track'
      ),
      people: allResults.filter(result => result.type === 'person'),
      collections: allResults.filter(result => result.type === 'collection'),
      totalResults: allResults.length,
    };
  } catch (error) {
    console.error('Search query failed:', error);
    return {
      movies: [],
      tv: [],
      music: [],
      people: [],
      collections: [],
      totalResults: 0,
    };
  }
}
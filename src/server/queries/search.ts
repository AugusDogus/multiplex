import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";
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
    console.log(`🔍 [SearchQuery] Starting search with params:`, params);
    
    // Get servers
    const servers = await plex.getServers();
    console.log(`🔍 [SearchQuery] Found ${servers?.length || 0} servers`);
    
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

    // Search all servers in parallel
    const serverPromises = servers.map(async (server) => {
      try {
        console.log(`🔍 [SearchQuery] Starting search on server: ${server.name}`);
        const serverClient = plex.createServerClient(server);
        const response = await serverClient.search(params);
        
        console.log(`🔍 [SearchQuery] Server ${server.name} responded with ${response.MediaContainer.SearchResult?.length || 0} raw results`);
        
        const results: ProcessedSearchResult[] = [];
        const searchResults = response.MediaContainer.SearchResult || [];
        
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
                ratingKey: directory.id?.toString() || directory.tagKey || directory.key,
                key: directory.key,
                guid: directory.tagKey || directory.key,
                type: 'person',
                title: directory.tag,
                summary: `${directory.count || 0} appearances`,
                thumb: directory.thumb,
                score: rawResult.score,
                serverId: server.clientIdentifier,
                serverName: server.name,
                librarySection: directory.librarySectionTitle || 'People',
              });
            }
          } catch (error) {
            console.warn(`Failed to process search result from ${server.name}:`, error);
          }
        }
        
        console.log(`🔍 [SearchQuery] Server ${server.name} processed ${results.length} results after filtering`);
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
    
    console.log(`🔍 [SearchQuery] Total combined results: ${allResults.length}`);
    console.log(`🔍 [SearchQuery] Result types breakdown:`, allResults.reduce((acc, result) => {
      acc[result.type] = (acc[result.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>));
    
    // Group by media type
    const groupedResults = {
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
    
    console.log(`🔍 [SearchQuery] Final grouped results:`, {
      movies: groupedResults.movies.length,
      tv: groupedResults.tv.length,
      music: groupedResults.music.length,
      people: groupedResults.people.length,
      collections: groupedResults.collections.length,
      total: groupedResults.totalResults,
    });
    
    return groupedResults;
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
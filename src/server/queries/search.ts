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
    
    // Debug: test with a known good search term if query is very short
    const debugParams = params.query.length < 3 ? { ...params, query: 'House' } : params;
    if (params.query !== debugParams.query) {
      console.log(`🔍 [SearchQuery] DEBUG: Using test query "${debugParams.query}" instead of "${params.query}"`);
    }
    
    // Get servers
    const servers = await plex.getServers();
    console.log(`🔍 [SearchQuery] Found ${servers?.length ?? 0} servers`);
    
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
        const response = await serverClient.search(debugParams);
        
        console.log(`🔍 [SearchQuery] Server ${server.name} responded with ${response.MediaContainer.SearchResult?.length ?? 0} raw results`);
        
        const results: ProcessedSearchResult[] = [];
        const searchResults = response.MediaContainer.SearchResult ?? [];
        
        console.log(`🔍 [SearchQuery] About to process ${searchResults.length} raw results from ${server.name}`);
        if (searchResults.length > 0) {
          console.log(`🔍 [SearchQuery] First raw result sample from ${server.name}:`, JSON.stringify(searchResults[0], null, 2));
        }
        
        for (const rawResult of searchResults) {
          try {
            console.log(`🔍 [SearchQuery] Processing result:`, { 
              hasMetadata: 'Metadata' in rawResult, 
              hasDirectory: 'Directory' in rawResult,
              score: rawResult.score,
              keys: Object.keys(rawResult)
            });
            
            // Use proper type guards for union types
            if (isMetadataResult(rawResult)) {
              console.log(`🔍 [SearchQuery] Processing metadata result...`);
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
              console.log(`🔍 [SearchQuery] Added metadata result: ${metadata.type} - ${metadata.title}`);
            } else if (isDirectoryResult(rawResult)) {
              console.log(`🔍 [SearchQuery] Processing directory result...`);
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
                librarySection: directory.librarySectionTitle ?? 'People',
              });
              console.log(`🔍 [SearchQuery] Added directory result: ${directory.tag}`);
            } else {
              console.warn(`🔍 [SearchQuery] Unhandled result type from ${server.name}:`, Object.keys(rawResult));
            }
          } catch (error) {
            console.warn(`🔍 [SearchQuery] Failed to process search result from ${server.name}:`, error);
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
    
    console.log(`🔍 [SearchQuery] Promise results:`, serverResults.map(result => ({
      status: result.status,
      resultCount: result.status === 'fulfilled' ? result.value.length : 0,
      error: result.status === 'rejected' ? result.reason?.message : undefined
    })));
    
    // Extract successful results
    const allResults = serverResults
      .filter((result): result is PromiseFulfilledResult<ProcessedSearchResult[]> => 
        result.status === 'fulfilled'
      )
      .flatMap(result => result.value);
      
    console.log(`🔍 [SearchQuery] Combined results before sorting: ${allResults.length}`);
    if (allResults.length > 0) {
      console.log(`🔍 [SearchQuery] Sample result:`, allResults[0]);
    }

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
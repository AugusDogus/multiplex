import type { PlexTvClient } from "~/lib/plex.tv/clients/plex-tv-client";
import {
  type SearchParams,
  type ProcessedSearchResult,
  type GroupedSearchResults,
} from "~/lib/plex.tv/schemas/search-schemas";
import { getServersQuery } from "./get-servers";

/**
 * Search across all user's Plex servers
 * @param plexClient - PlexTvClient instance
 * @param params - Search parameters
 * @returns Grouped search results from all servers
 */
export async function searchQuery(
  plexClient: PlexTvClient,
  params: SearchParams,
): Promise<GroupedSearchResults> {
  try {
    // Get user's servers
    const servers = await getServersQuery(plexClient);
    
    if (servers.length === 0) {
      return {
        movies: [],
        tv: [],
        music: [],
        people: [],
        collections: [],
        totalResults: 0,
      };
    }

    // Search all servers in parallel using Promise.allSettled to handle individual server failures
    const searchPromises = servers.map(async (server) => {
      console.log(`🔍 Starting search on server: ${server.name}`);
      const serverClient = plexClient.createServerClient(server);
      const response = await serverClient.search(params);
      
      console.log(`📡 Search response from ${server.name}:`, {
        size: response.MediaContainer.size,
        resultCount: response.MediaContainer.SearchResult?.length || 0,
        hasSearchResults: !!response.MediaContainer.SearchResult,
        searchResultExists: 'SearchResult' in response.MediaContainer,
        responseKeys: Object.keys(response.MediaContainer),
      });
      
      // Log first few characters of the raw response for debugging
      if (response.MediaContainer.size === 0) {
        console.log(`⚠️ Empty response from ${server.name}. MediaContainer keys:`, Object.keys(response.MediaContainer));
      }
      
      // Process and transform results
                    const processedResults: ProcessedSearchResult[] = [];
      
      const searchResults = response.MediaContainer.SearchResult || [];
      console.log(`🔄 Processing ${searchResults.length} results from ${server.name}`);
      
      if (searchResults.length > 0) {
        for (const result of searchResults) {
          try {
            let processedResult: ProcessedSearchResult;
            
            if ('Metadata' in result) {
                // Handle media results (movies, TV shows, music, etc.)
                const metadata = result.Metadata;
                
                processedResult = {
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
                  score: result.score,
                  serverId: server.clientIdentifier,
                  serverName: server.name,
                  librarySection: metadata.librarySectionTitle,
                  // TV Show specific fields
                  parentTitle: metadata.parentTitle,
                  grandparentTitle: metadata.grandparentTitle,
                  seasonNumber: metadata.parentIndex,
                  episodeNumber: metadata.index,
                  // Music specific fields
                  artistName: metadata.grandparentTitle, // For music, grandparent is typically the artist
                  albumName: metadata.parentTitle, // For music, parent is typically the album
                };
              } else if ('Directory' in result) {
                // Handle directory results (people/actors)
                const directory = result.Directory;
                
                processedResult = {
                  ratingKey: directory.id?.toString() || directory.tagKey || directory.key,
                  key: directory.key,
                  guid: directory.tagKey || directory.key,
                  type: 'person' as const,
                  title: directory.tag,
                  summary: `${directory.count || 0} appearances`,
                  thumb: directory.thumb,
                  score: result.score,
                  serverId: server.clientIdentifier,
                  serverName: server.name,
                  librarySection: directory.librarySectionTitle || 'People',
                };
              } else {
                console.warn(`⚠️ Unknown result type from ${server.name}:`, result);
                continue;
              }
              
              processedResults.push(processedResult);
            } catch (error) {
              console.error(`❌ Error processing result from ${server.name}:`, error, result);
            }
          }
        }
      
      console.log(`✅ Processed ${processedResults.length} results from ${server.name}`);
      return processedResults;
    });

    // Wait for all searches to complete, handling individual server failures gracefully
    const searchResults = await Promise.allSettled(searchPromises);
    
    console.log(`🔄 Promise.allSettled completed. Processing ${searchResults.length} server results`);
    
    // Extract successful results and log failures
    const allResults: ProcessedSearchResult[][] = [];
    for (const result of searchResults) {
      if (result.status === 'fulfilled') {
        console.log(`✅ Server search succeeded with ${result.value.length} results`);
        allResults.push(result.value);
      } else {
        console.warn('❌ Server search failed:', result.reason);
      }
    }
    
    // Flatten and combine results from all servers
    const combinedResults = allResults.flat();
    console.log(`🔗 Combined results: ${combinedResults.length} total results`);
    
    // Sort by relevance score (descending)
    combinedResults.sort((a, b) => b.score - a.score);
    
    // Group results by media type
    const groupedResults: GroupedSearchResults = {
      movies: combinedResults.filter(result => result.type === 'movie'),
      tv: combinedResults.filter(result => 
        result.type === 'show' || result.type === 'episode'
      ),
      music: combinedResults.filter(result => 
        result.type === 'artist' || result.type === 'album' || result.type === 'track'
      ),
      people: combinedResults.filter(result => result.type === 'person'),
      collections: combinedResults.filter(result => result.type === 'collection'),
      totalResults: combinedResults.length,
    };
    
    console.log(`📊 Grouped results:`, {
      movies: groupedResults.movies.length,
      tv: groupedResults.tv.length,
      music: groupedResults.music.length,
      people: groupedResults.people.length,
      collections: groupedResults.collections.length,
      total: groupedResults.totalResults
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
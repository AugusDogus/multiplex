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

    // Search all servers in parallel
    const searchPromises = servers.map(async (server) => {
      try {
        const serverClient = plexClient.createServerClient(server);
        const response = await serverClient.search(params);
        
        // Process and transform results
        const processedResults: ProcessedSearchResult[] = [];
        
        const searchResults = response.MediaContainer.SearchResult ?? [];
        if (searchResults.length > 0) {
          for (const result of searchResults) {
            const metadata = result.Metadata;
            
            const processedResult: ProcessedSearchResult = {
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
            
            processedResults.push(processedResult);
          }
        }
        
        return processedResults;
      } catch (error) {
        console.warn(`Search failed for server ${server.name}:`, error);
        return [];
      }
    });

    // Wait for all searches to complete
    const allResults = await Promise.all(searchPromises);
    
    // Flatten and combine results from all servers
    const combinedResults = allResults.flat();
    
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
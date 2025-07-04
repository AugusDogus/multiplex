# Auto-Play Next Episode Feature Implementation

## Overview

Successfully implemented auto-play functionality for TV show episodes with 5-second countdown overlay, following existing media player patterns and integrating with the current Plex API infrastructure.

## Research Findings

### Plex API Endpoints

Based on research of the Plex API documentation, the key endpoint for getting next episode information is:

- **`/library/metadata/{seasonRatingKey}/children`** - Returns all episodes in a season
- Episodes contain `index` (episode number), `parentIndex` (season number), and relationship keys
- Episodes are automatically sorted by index, making it easy to find the next episode

### Existing Codebase Patterns

1. **State Management**: Uses Jotai atoms for reactive state management
2. **Overlay System**: Follows pattern established by `MediaPlayerSkipOverlay`
3. **tRPC Integration**: Existing pattern for Plex API calls via tRPC endpoints
4. **Component Structure**: Modular approach with hooks for complex logic

## Implementation Details

### 1. Enhanced State Management

**File**: `src/types/media-player.ts`
- Added `NextEpisodeInfo` interface for episode metadata
- Extended `MediaPlayerState` with `autoPlay` state containing:
  - `isEnabled`: Auto-play functionality status
  - `isCountingDown`: Whether countdown is active
  - `countdownSeconds`: Current countdown value (5-0)
  - `nextEpisode`: Information about the next episode
  - `countdownTimeout`: Timer reference for cleanup

**File**: `src/atoms/media-player.ts`
- Added new atoms for auto-play management:
  - `startAutoPlayCountdownAtom`: Initiates 5-second countdown
  - `cancelAutoPlayAtom`: Cancels countdown
  - `triggerAutoPlayAtom`: Starts next episode playback
- Updated existing atoms to handle auto-play state cleanup

### 2. Plex API Integration

**File**: `src/lib/plex.tv/clients/plex-server-client.ts`
- Added `getSeasonEpisodes()` method to fetch episodes for a season

**File**: `src/server/api/routers/plex.ts`
- New `getNextEpisode` tRPC endpoint that:
  - Takes current episode info (ratingKey, season, index)
  - Fetches season episodes via Plex API
  - Finds next episode by incrementing index
  - Returns formatted episode metadata

### 3. User Interface Components

**File**: `src/components/media-player/media-player-autoplay-overlay.tsx`
- New overlay component following skip overlay pattern
- Displays:
  - Show title and episode information
  - Countdown timer (5 seconds)
  - "Play Now" and "Cancel" buttons
- Positioned at bottom center with modern styling

**File**: `src/components/media-player/hooks/use-auto-play-next-episode.ts`
- Custom hook managing auto-play logic:
  - Detects when episode is in last 30 seconds
  - Fetches next episode information via tRPC
  - Starts countdown in last 10 seconds
  - Handles timing and state coordination

### 4. Integration with Media Player

**File**: `src/components/media-player/media-player-modal.tsx`
- Integrated auto-play hook and overlay
- Added alongside existing skip overlay
- Follows established patterns for overlay management

## User Experience Flow

1. **Episode Detection**: When watching TV episodes, system detects last 30 seconds
2. **Next Episode Lookup**: Queries Plex API for next episode in series
3. **Countdown Display**: Shows overlay with episode info and 5-second countdown
4. **User Control**: User can cancel or trigger immediate playback
5. **Auto-Play**: Automatically starts next episode when countdown reaches zero

## API Response Schema

Next episode response structure:
```typescript
{
  found: boolean;
  episode: {
    ratingKey: string;
    key: string;
    title: string;
    index: number;
    parentIndex: number;
    thumb?: string;
    art?: string;
    duration?: number;
    summary?: string;
    grandparentTitle?: string; // Show title
    parentTitle?: string;      // Season title
  } | null;
}
```

## Future Enhancements

### Cross-Season Support
Current implementation handles same-season episodes. To support cross-season functionality:

1. **Additional API Calls**: Get show seasons when current season ends
2. **Season Metadata**: Fetch next season's first episode
3. **Enhanced Logic**: Update `getNextEpisode` endpoint for season transitions

### User Preferences
Potential additions:
- Settings toggle for auto-play enable/disable
- Configurable countdown duration
- Skip intro/outro during auto-play

### Advanced Features
- Queue integration for multi-episode watching
- Smart detection of series vs. limited series
- Integration with Plex's "Up Next" recommendations

## Technical Considerations

### Performance
- API calls only triggered in last 30 seconds of episodes
- Cached responses prevent repeated calls
- Efficient state management with Jotai atoms

### Error Handling
- Graceful fallback when next episode not found
- Network error handling in tRPC queries
- Timeout cleanup to prevent memory leaks

### Accessibility
- Proper ARIA labels and semantic markup
- Keyboard navigation support
- Screen reader friendly countdown announcements

## Testing Strategy

### Unit Tests
- Auto-play hook logic
- State atom updates
- Component rendering conditions

### Integration Tests
- tRPC endpoint functionality
- Plex API integration
- End-to-end user flows

### Edge Cases
- Last episode of season/series
- Network connectivity issues
- Malformed API responses
- Rapid user interactions

## Conclusion

The auto-play next episode feature has been successfully implemented following Netflix-style UX patterns while maintaining consistency with the existing codebase architecture. The modular approach allows for easy testing, maintenance, and future enhancements.

The implementation leverages existing infrastructure (Jotai, tRPC, component patterns) while extending functionality in a clean, maintainable way that follows the established conventions of the media player system.
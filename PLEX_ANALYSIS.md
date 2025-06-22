# Plex Implementation Analysis: Problems & Code Smells

## 🚨 Critical Issues

### 1. **No Caching Strategy**
**Location**: `src/server/api/routers/plex.ts`
**Problem**: Every page load triggers fresh API calls to all Plex servers
```typescript
// This runs on EVERY page load - no caching!
getAllServerLibraries: protectedProcedure.query(async ({ ctx }) => {
  const servers = await ctx.plex.getServers(); // API call
  const results = await Promise.all(serverLibrariesPromises); // More API calls
});
```
**Impact**: 
- Slow page loads
- Unnecessary server load
- Potential rate limiting from Plex servers
- Poor user experience

**Solution**: Implement TRPC caching or React Query with stale-while-revalidate

### 2. **Promise.all Blocking Behavior**
**Location**: `src/server/api/routers/plex.ts:84`
**Problem**: One slow/failed server blocks the entire response
```typescript
const results = await Promise.all(serverLibrariesPromises);
```
**Impact**:
- One offline server = entire sidebar fails to load
- Slow servers make everything slow
- No progressive loading

**Solution**: Use `Promise.allSettled` or implement timeout per server

### 3. **Type Safety Erosion**
**Location**: `src/lib/plex.tv/utils.ts`
**Problem**: Using `unknown[]` and losing type safety
```typescript
const allSections: unknown[] = []; // Type safety lost!
```
**Impact**:
- Runtime errors possible
- No IntelliSense support
- Harder to refactor

**Solution**: Proper union types or discriminated unions

## ⚠️ Performance Issues

### 4. **Expensive useMemo Dependencies**
**Location**: `src/components/app-sidebar.tsx:73-101`
**Problem**: Complex objects as dependencies cause unnecessary re-renders
```typescript
const allLibrarySources = React.useMemo(() => {
  // Complex processing
}, [serverLibraries]); // Entire serverLibraries array as dependency
```
**Impact**:
- Excessive re-computations
- Poor rendering performance
- Memory leaks from retained closures

**Solution**: Stabilize dependencies or use more granular memoization

### 5. **N+1 Processing Pattern**
**Location**: `src/lib/plex.tv/utils.ts:13-45`
**Problem**: Multiple nested loops through the same data
```typescript
for (const provider of mediaContainer.MediaContainer.MediaProvider) { // Loop 1
  for (const directory of contentFeature.Directory) { // Loop 2
    // Then in sidebar:
    for (const extractedSource of extractedSources) { // Loop 3
```
**Impact**:
- O(n²) or O(n³) complexity
- Poor performance with many libraries
- Inefficient memory usage

**Solution**: Single-pass processing or flattening data structure

### 6. **Memory Leak Potential**
**Location**: `src/components/app-sidebar.tsx:106-125`
**Problem**: Complex object matching retains references
```typescript
const matchingLibrarySource = allLibrarySources.find(
  (libSource) =>
    libSource.machineIdentifier === pinnedSource.machineIdentifier &&
    libSource.directoryID === pinnedSource.directoryID,
);
```
**Impact**:
- Objects not garbage collected
- Memory usage grows over time
- Potential crashes on memory-constrained devices

## 🔧 Code Smells

### 7. **String-Based Type Discrimination**
**Location**: `src/lib/plex.tv/utils.ts:91`
**Problem**: Using string matching for logic branching
```typescript
if (extractedSource.provider === "Live TV & DVR") {
  // Fragile string matching
}
```
**Impact**:
- Breaks if strings change
- No compile-time checking
- Hard to refactor

**Solution**: Use enums or discriminated unions

### 8. **Console.log in Production**
**Location**: Multiple files
**Problem**: Debug logs left in production code
```typescript
console.log("Processing provider:", provider.title);
console.log("All extracted sources:", sources);
```
**Impact**:
- Performance overhead
- Cluttered console
- Potential information leakage

**Solution**: Use proper logging library with levels

### 9. **Magic String URLs**
**Location**: `src/lib/plex.tv/utils.ts:88-95`
**Problem**: Hard-coded URL patterns scattered throughout code
```typescript
href = `/media/${serverId}/${extractedSource.providerIdentifier}?source=${extractedSource.id}`;
href = `/live-tv/${serverId}/${extractedSource.providerIdentifier}`;
```
**Impact**:
- Hard to maintain
- No single source of truth
- Easy to introduce bugs

**Solution**: Centralized URL builder utility

### 10. **Complex Schema with .passthrough()**
**Location**: `src/lib/plex.tv/schemas.ts:82`
**Problem**: Using passthrough loses validation benefits
```typescript
}).passthrough(), // Allow other properties we don't care about
```
**Impact**:
- Unknown data structure
- Potential runtime errors
- Harder to debug issues

**Solution**: Explicit schema definition or strict mode

## 🎯 Architectural Issues

### 11. **Tight Coupling Between Layers**
**Problem**: UI component directly knows about API response structure
```typescript
// UI component imports and uses API response types directly
import type { plexRouterOutputs } from "~/server/api/routers/plex";
```
**Impact**:
- Hard to change API without breaking UI
- No abstraction layer
- Difficult testing

**Solution**: Domain models and adapters

### 12. **Missing Error Boundaries**
**Location**: UI layer
**Problem**: No React error boundaries around Plex components
**Impact**:
- One error crashes entire app
- Poor user experience
- No graceful degradation

**Solution**: Implement error boundaries with fallback UI

### 13. **No Request Deduplication**
**Location**: Client layer
**Problem**: Multiple simultaneous requests to same server
**Impact**:
- Wasted bandwidth
- Server overload
- Race conditions

**Solution**: Request deduplication middleware

## 🐛 Potential Footguns

### 14. **Implicit Provider Order Dependency**
**Location**: `src/lib/plex.tv/utils.ts:15`
**Problem**: Code assumes providers are in specific order
```typescript
const contentFeature = provider.Feature.find(
  feature => feature.type === "content" && feature.Directory
);
```
**Impact**:
- Breaks if Plex changes provider order
- Silent failures
- Hard to debug

**Solution**: More robust provider identification

### 15. **Regex ID Extraction**
**Location**: `src/lib/plex.tv/utils.ts:57`
**Problem**: Brittle regex parsing for IDs
```typescript
const match = directory.hubKey.match(/\/hubs\/sections\/(\d+)/);
```
**Impact**:
- Breaks if URL format changes
- Silent failures with wrong IDs
- Security implications

**Solution**: Use URL parsing libraries

### 16. **Unhandled Edge Cases**
**Problem**: No handling for:
- Empty server responses
- Malformed data
- Network timeouts
- Authentication failures
- Server version incompatibilities

**Impact**:
- App crashes
- Poor user experience
- Silent failures

## 📈 Recommended Improvements

### Priority 1 (Critical)
1. **Add caching strategy** (React Query with background refresh)
2. **Replace Promise.all with Promise.allSettled**
3. **Add proper error boundaries**
4. **Fix type safety issues**

### Priority 2 (High)
1. **Implement request deduplication**
2. **Add proper logging**
3. **Centralize URL generation**
4. **Optimize useMemo dependencies**

### Priority 3 (Medium)
1. **Add unit tests for utils**
2. **Implement proper loading states**
3. **Add retry mechanisms**
4. **Extract domain models**

### Example Fix for Promise.all Issue
```typescript
// Instead of:
const results = await Promise.all(serverLibrariesPromises);

// Use:
const results = await Promise.allSettled(serverLibrariesPromises);
const successfulResults = results
  .filter((result): result is PromiseFulfilledResult<ServerLibrary> => 
    result.status === 'fulfilled'
  )
  .map(result => result.value);
```

### Example Fix for Caching
```typescript
// Add to TRPC router:
getAllServerLibraries: protectedProcedure
  .query(async ({ ctx }) => {
    // ... existing logic
  })
  .experimental_cached({
    ttl: 5 * 60 * 1000, // 5 minutes
    tags: ['plex-libraries'],
  });
```

## 🎯 Technical Debt Score

- **Performance**: 6/10 (multiple optimization opportunities)
- **Maintainability**: 5/10 (complex, tightly coupled)
- **Reliability**: 4/10 (many failure points)
- **Security**: 7/10 (mostly safe, some regex concerns)
- **Type Safety**: 5/10 (some unsafe patterns)

**Overall**: 5.4/10 - Functional but needs significant improvement 
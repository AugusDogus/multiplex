/**
 * Configuration for auto-refresh behavior
 */
export interface AutoRefreshConfig {
  /** Auto-refresh interval in milliseconds */
  refreshInterval: number;
  /** Whether auto-refresh is enabled */
  enabled: boolean;
}

/**
 * Default auto-refresh configuration
 */
const DEFAULT_CONFIG: AutoRefreshConfig = {
  refreshInterval: 5000, // 5 seconds
  enabled: true,
};

/**
 * Hook to manage auto-refresh configuration
 * 
 * In the future, this could be extended to:
 * - Store user preferences in localStorage using useSyncExternalStore
 * - Provide different refresh rates based on user activity
 * - Pause refresh on metered connections
 * - Allow user customization through settings
 */
export function useAutoRefreshConfig(): AutoRefreshConfig {
  // For now, return the default config
  // Future enhancement: Use useSyncExternalStore to sync with localStorage
  return DEFAULT_CONFIG;
}

/**
 * Predefined refresh intervals for user selection
 */
export const REFRESH_INTERVALS = {
  DISABLED: 0,
  FAST: 2000,      // 2 seconds - for development/testing
  NORMAL: 5000,    // 5 seconds - default
  SLOW: 10000,     // 10 seconds
  VERY_SLOW: 30000, // 30 seconds
} as const;
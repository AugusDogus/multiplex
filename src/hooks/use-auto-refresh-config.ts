import { useState, useEffect } from "react";

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
 * - Store user preferences in localStorage
 * - Provide different refresh rates based on user activity
 * - Pause refresh on metered connections
 * - Allow user customization through settings
 */
export function useAutoRefreshConfig(): AutoRefreshConfig {
  const [config, setConfig] = useState<AutoRefreshConfig>(DEFAULT_CONFIG);

  // Future enhancement: Load user preferences from localStorage
  useEffect(() => {
    // TODO: Load saved preferences
    // const saved = localStorage.getItem('autoRefreshConfig');
    // if (saved) {
    //   try {
    //     const parsed = JSON.parse(saved);
    //     setConfig({ ...DEFAULT_CONFIG, ...parsed });
    //   } catch (error) {
    //     console.warn('Failed to parse auto-refresh config:', error);
    //   }
    // }
  }, []);

  // Future enhancement: Save preferences when they change
  // useEffect(() => {
  //   localStorage.setItem('autoRefreshConfig', JSON.stringify(config));
  // }, [config]);

  return config;
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
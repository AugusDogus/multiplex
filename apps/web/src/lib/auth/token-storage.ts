import { useCallback, useEffect, useSyncExternalStore } from "react";

/* ────────────────────────────────────────────────────────────
   Token Storage
   localStorage wrapper for Plex authentication tokens with
   React hooks for reactive state management
   ──────────────────────────────────────────────────────────── */

const STORAGE_KEY = "plex_auth_token";
const USER_KEY = "plex_user";

// Event name for cross-tab synchronization
const STORAGE_EVENT = "plex_token_change";

/* ────────────────────────────────────────────────────────────
   Storage Functions
   ──────────────────────────────────────────────────────────── */

/**
 * Get the stored Plex auth token
 * @returns The stored token or null if not found
 */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    console.warn("Failed to read token from localStorage");
    return null;
  }
}

/**
 * Store the Plex auth token
 * @param token - The token to store
 */
export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
    // Dispatch custom event for same-tab reactivity
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: token }));
  } catch {
    console.warn("Failed to write token to localStorage");
  }
}

/**
 * Remove the stored Plex auth token
 */
export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Dispatch custom event for same-tab reactivity
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: null }));
  } catch {
    console.warn("Failed to clear token from localStorage");
  }
}

/**
 * Check if a token is stored
 * @returns true if a token is stored
 */
export function hasStoredToken(): boolean {
  return getStoredToken() !== null;
}

/* ────────────────────────────────────────────────────────────
   User Storage Functions
   ──────────────────────────────────────────────────────────── */

export interface StoredUser {
  id: number;
  uuid: string;
  username: string;
  friendlyName: string;
  email: string;
  thumb: string;
}

/**
 * Get the stored user info
 * @returns The stored user or null if not found
 */
export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const data = localStorage.getItem(USER_KEY);
    if (!data) return null;
    return JSON.parse(data) as StoredUser;
  } catch {
    console.warn("Failed to read user from localStorage");
    return null;
  }
}

/**
 * Store the user info
 * @param user - The user to store
 */
export function setStoredUser(user: StoredUser): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { user } }));
  } catch {
    console.warn("Failed to write user to localStorage");
  }
}

/**
 * Remove the stored user info
 */
export function clearStoredUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { user: null } }));
  } catch {
    console.warn("Failed to clear user from localStorage");
  }
}

/**
 * Clear all auth data (token and user)
 */
export function clearAllAuthData(): void {
  clearStoredToken();
  clearStoredUser();
}

/* ────────────────────────────────────────────────────────────
   React Hooks
   ──────────────────────────────────────────────────────────── */

// Subscribers for external store
let tokenListeners: Array<() => void> = [];

function subscribeToTokenChanges(callback: () => void): () => void {
  tokenListeners.push(callback);

  // Listen for storage events (cross-tab)
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  // Listen for custom events (same-tab)
  const handleCustomEvent = () => {
    callback();
  };

  window.addEventListener("storage", handleStorageEvent);
  window.addEventListener(STORAGE_EVENT, handleCustomEvent);

  return () => {
    tokenListeners = tokenListeners.filter((l) => l !== callback);
    window.removeEventListener("storage", handleStorageEvent);
    window.removeEventListener(STORAGE_EVENT, handleCustomEvent);
  };
}

function getTokenSnapshot(): string | null {
  return getStoredToken();
}

function getServerTokenSnapshot(): string | null {
  return null; // SSR always returns null
}

/**
 * React hook to get and subscribe to the Plex auth token
 * @returns The current token or null
 */
export function usePlexToken(): string | null {
  return useSyncExternalStore(subscribeToTokenChanges, getTokenSnapshot, getServerTokenSnapshot);
}

/**
 * React hook to manage Plex auth state
 * @returns Object with token, user, and auth management functions
 */
export function usePlexAuth() {
  const token = usePlexToken();

  const setToken = useCallback((newToken: string) => {
    setStoredToken(newToken);
  }, []);

  const clearToken = useCallback(() => {
    clearStoredToken();
  }, []);

  const logout = useCallback(() => {
    clearAllAuthData();
  }, []);

  const isAuthenticated = token !== null;

  return {
    token,
    isAuthenticated,
    setToken,
    clearToken,
    logout,
  };
}

/**
 * React hook to get the stored user
 * Note: This doesn't auto-update on changes, use with usePlexToken for reactivity
 */
export function usePlexUser(): StoredUser | null {
  const token = usePlexToken(); // Re-render when token changes

  // Return stored user whenever token changes
  useEffect(() => {
    // This effect just ensures re-render on token change
  }, [token]);

  return getStoredUser();
}

/**
 * React hook for complete auth state management
 */
export function useAuth() {
  const { token, isAuthenticated, setToken, logout } = usePlexAuth();
  const user = usePlexUser();

  const login = useCallback(
    (authToken: string, userData: StoredUser) => {
      setStoredUser(userData);
      setToken(authToken);
    },
    [setToken],
  );

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
  };
}

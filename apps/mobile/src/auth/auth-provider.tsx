import type { ReactNode } from "react";

import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  beginDeviceAuthorization,
  pollDeviceAuthorization,
  resolveVerificationUrl,
  validateAccessToken,
} from "~/lib/device-auth";
import { getBaseUrl } from "~/lib/base-url";

const ACCESS_TOKEN_KEY = "multiplex_mobile_access_token";

export type AuthState =
  | { kind: "restoring" }
  | { kind: "signedOut" }
  | {
      kind: "linking";
      userCode: string;
      verificationUrl: string;
      expiresAt: number;
    }
  | { kind: "signedIn"; accessToken: string }
  | { kind: "error"; message: string };

interface AuthContextValue {
  state: AuthState;
  beginLink: () => Promise<void>;
  cancelLink: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "restoring" });
  const pollGeneration = useRef(0);

  useEffect(() => {
    let active = true;

    async function restore() {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (!active) return;
      if (token && (await validateAccessToken(token))) {
        setState({ kind: "signedIn", accessToken: token });
        return;
      }
      if (token) {
        await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      }
      if (active) {
        setState({ kind: "signedOut" });
      }
    }

    void restore();
    return () => {
      active = false;
    };
  }, []);

  const cancelLink = useCallback(() => {
    pollGeneration.current += 1;
    void WebBrowser.dismissBrowser();
    setState({ kind: "signedOut" });
  }, []);

  const beginLink = useCallback(async () => {
    const generation = pollGeneration.current + 1;
    pollGeneration.current = generation;

    try {
      const authorization = await beginDeviceAuthorization();
      const verificationUrl = resolveVerificationUrl(authorization);
      const expiresAt = Date.now() + authorization.expires_in * 1_000;
      setState({
        kind: "linking",
        userCode: authorization.user_code,
        verificationUrl,
        expiresAt,
      });
      void WebBrowser.openBrowserAsync(verificationUrl);

      let intervalSeconds = authorization.interval;
      while (pollGeneration.current === generation && Date.now() < expiresAt) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, intervalSeconds * 1_000);
        });
        if (pollGeneration.current !== generation) return;

        const result = await pollDeviceAuthorization({
          deviceCode: authorization.device_code,
          intervalSeconds,
        });
        if (result.kind === "pending") {
          intervalSeconds = result.intervalSeconds;
          continue;
        }
        if (result.kind === "authorized") {
          await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.accessToken);
          await WebBrowser.dismissBrowser();
          setState({ kind: "signedIn", accessToken: result.accessToken });
          return;
        }
        setState({ kind: "error", message: result.message });
        return;
      }

      if (pollGeneration.current === generation) {
        setState({
          kind: "error",
          message: "The device-link code expired. Start again for a new code.",
        });
      }
    } catch (cause) {
      setState({
        kind: "error",
        message:
          cause instanceof Error ? cause.message : "Multiplex could not start device linking.",
      });
    }
  }, []);

  const signOut = useCallback(async () => {
    pollGeneration.current += 1;
    const token = state.kind === "signedIn" ? state.accessToken : null;
    if (token) {
      await fetch(`${getBaseUrl()}/api/auth/sign-out`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    setState({ kind: "signedOut" });
  }, [state]);

  const value = useMemo(
    () => ({ state, beginLink, cancelLink, signOut }),
    [beginLink, cancelLink, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

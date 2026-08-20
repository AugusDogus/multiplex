import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { HeroUINativeProvider } from "heroui-native/provider";
import { QueryClientProvider } from "@tanstack/react-query";

import { api, createApiClient, createQueryClient } from "~/api";
import { AuthProvider, useAuth } from "~/auth/auth-provider";
import { LoginScreen } from "~/screens/login-screen";
import { GuestWatchTogetherScreen } from "~/screens/guest-watch-together-screen";
import { parseGuestCapability } from "~/lib/guest-invite";
import { RootNavigator } from "~/navigation/root-navigator";

import "./styles.css";

function SignedInApp({ accessToken }: { accessToken: string }) {
  const [queryClient] = useState(createQueryClient);
  const [apiClient] = useState(() => createApiClient(accessToken));

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={apiClient} queryClient={queryClient}>
        <RootNavigator />
      </api.Provider>
    </QueryClientProvider>
  );
}

function AppGate() {
  const { state } = useAuth();
  const incomingUrl = Linking.useURL();
  const [guestCapability, setGuestCapability] = useState<string | null>(() =>
    incomingUrl ? parseGuestCapability(incomingUrl) : null,
  );

  useEffect(() => {
    const capability = incomingUrl ? parseGuestCapability(incomingUrl) : null;
    if (capability) setGuestCapability(capability);
  }, [incomingUrl]);

  if (guestCapability) {
    return (
      <GuestWatchTogetherScreen
        capability={guestCapability}
        onClose={() => setGuestCapability(null)}
      />
    );
  }

  return state.kind === "signedIn" ? (
    <SignedInApp key={state.accessToken} accessToken={state.accessToken} />
  ) : (
    <LoginScreen onOpenGuestInvite={setGuestCapability} />
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <AuthProvider>
            <View className="bg-background flex-1">
              <AppGate />
              <StatusBar />
            </View>
          </AuthProvider>
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

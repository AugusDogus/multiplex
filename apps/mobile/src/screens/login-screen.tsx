import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "~/auth/auth-provider";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import { parseGuestCapability } from "~/lib/guest-invite";

export function LoginScreen({
  onOpenGuestInvite,
}: {
  onOpenGuestInvite: (capability: string) => void;
}) {
  const { state, beginLink, cancelLink } = useAuth();
  const [guestLink, setGuestLink] = useState("");
  const [guestLinkError, setGuestLinkError] = useState<string | null>(null);

  const openGuestLink = () => {
    const capability = parseGuestCapability(guestLink);
    if (!capability) {
      setGuestLinkError("Paste a valid Multiplex guest invite link.");
      return;
    }
    setGuestLinkError(null);
    onOpenGuestInvite(capability);
  };

  return (
    <Screen scroll={false} testID="login-screen">
      <View className="flex-1 justify-between pt-12 pb-8">
        <View className="flex-1 items-center justify-center gap-5">
          <View className="bg-accent size-16 items-center justify-center rounded-3xl">
            <Ionicons name="infinite" size={34} color="#241900" />
          </View>
          <View className="items-center gap-2">
            <Text className="text-4xl font-bold tracking-tight">Multiplex</Text>
            <Text className="text-muted max-w-72 text-center leading-6">
              Your Plex libraries, Live TV, playlists, and Watch Together on your phone.
            </Text>
          </View>
        </View>

        {state.kind === "linking" ? (
          <View className="bg-surface gap-4 rounded-3xl p-5">
            <View className="items-center gap-2">
              <ActivityIndicator />
              <Text className="text-muted text-sm">Waiting for approval</Text>
              <Text className="text-4xl font-bold tracking-[10px]">{state.userCode}</Text>
              <Text className="text-muted text-center text-sm leading-5">
                Sign in with Plex in the browser, then approve this code. The app will continue
                automatically.
              </Text>
            </View>
            <Button variant="secondary" onPress={cancelLink}>
              Cancel
            </Button>
          </View>
        ) : (
          <View className="gap-3">
            {state.kind === "error" ? (
              <Text className="text-danger text-center text-sm">{state.message}</Text>
            ) : null}
            <Button
              className="w-full active:scale-[0.97]"
              isDisabled={state.kind === "restoring"}
              onPress={() => void beginLink()}
              testID="continue-with-plex"
            >
              {state.kind === "restoring" ? "Restoring session…" : "Continue with Plex"}
            </Button>
            <Text className="text-muted text-center text-xs leading-5">
              Your Plex password stays with Plex. Multiplex stores a revocable device session.
            </Text>
            <View className="my-2 h-px bg-white/10" />
            <Text className="text-center font-semibold">Joining as a guest?</Text>
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste a Watch Together link"
              testID="guest-invite-input"
              value={guestLink}
              onChangeText={setGuestLink}
              onSubmitEditing={openGuestLink}
            />
            {guestLinkError ? (
              <Text className="text-danger text-center text-sm" testID="guest-invite-error">
                {guestLinkError}
              </Text>
            ) : null}
            <Button
              variant="secondary"
              isDisabled={!guestLink.trim()}
              onPress={openGuestLink}
              testID="open-guest-invite"
            >
              Open guest invite
            </Button>
          </View>
        )}
      </View>
    </Screen>
  );
}

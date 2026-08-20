import { View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native/button";

import { api } from "~/api";
import { useAuth } from "~/auth/auth-provider";
import { ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";

export function ProfileScreen() {
  const { signOut } = useAuth();
  const user = api.plex.getUserInfo.useQuery();

  return (
    <Screen title="Profile" subtitle="Your linked Plex account." testID="profile-screen">
      {user.isPending ? (
        <LoadingState />
      ) : user.isError ? (
        <ErrorState onRetry={() => void user.refetch()} />
      ) : (
        <View className="bg-surface items-center gap-4 rounded-3xl p-6">
          <View className="bg-default size-24 items-center justify-center overflow-hidden rounded-full">
            {user.data.thumb ? (
              <Image
                source={{ uri: user.data.thumb }}
                style={{ width: 96, height: 96 }}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="person" size={44} color="#888" />
            )}
          </View>
          <View className="items-center gap-1">
            <Text className="text-2xl font-bold">{user.data.friendlyName}</Text>
            <Text className="text-muted text-sm">@{user.data.username}</Text>
            <Text className="text-muted text-sm">{user.data.email}</Text>
          </View>
        </View>
      )}
      <Button variant="secondary" onPress={() => void signOut()} testID="sign-out">
        Sign out
      </Button>
    </Screen>
  );
}

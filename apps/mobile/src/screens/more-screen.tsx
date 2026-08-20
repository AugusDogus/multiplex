import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

const DESTINATIONS = [
  {
    route: "WatchTogether",
    testID: "more-watch-together",
    icon: "people-outline",
    title: "Watch Together",
    description: "Join rooms, invite friends, and watch in sync.",
  },
  {
    route: "LiveTv",
    testID: "more-live-tv",
    icon: "tv-outline",
    title: "Live TV",
    description: "Browse current and upcoming channel programming.",
  },
  {
    route: "Profile",
    testID: "more-profile",
    icon: "person-circle-outline",
    title: "Profile",
    description: "View your Plex account and sign out.",
  },
] satisfies Array<{
  route: "WatchTogether" | "LiveTv" | "Profile";
  testID: "more-watch-together" | "more-live-tv" | "more-profile";
  icon: "people-outline" | "tv-outline" | "person-circle-outline";
  title: string;
  description: string;
}>;

export function MoreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Screen title="More" subtitle="Sessions, Live TV, and account settings." testID="more-screen">
      <View className="gap-3">
        {DESTINATIONS.map((destination) => (
          <Pressable
            key={destination.route}
            className="bg-surface flex-row items-center gap-4 rounded-2xl p-4 active:scale-[0.98]"
            onPress={() => navigation.navigate(destination.route)}
            testID={destination.testID}
          >
            <View className="bg-default size-12 items-center justify-center rounded-2xl">
              <Ionicons name={destination.icon} size={24} color="#888" />
            </View>
            <View className="flex-1 gap-1">
              <Text className="font-semibold">{destination.title}</Text>
              <Text className="text-muted text-sm leading-5">{destination.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

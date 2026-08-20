import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "heroui-native/button";
import { useNavigation } from "@react-navigation/native";

import { api } from "~/api";
import { MediaRow } from "~/components/media-row";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const continueWatching = api.plex.getAllContinueWatching.useQuery();
  const hubs = api.plex.getHomeHubs.useQuery();
  const rooms = api.plex.getWatchTogetherRooms.useQuery();
  const refreshing = continueWatching.isRefetching || hubs.isRefetching || rooms.isRefetching;

  if (continueWatching.isPending && hubs.isPending) {
    return (
      <SafeAreaView className="bg-background flex-1" testID="home-screen">
        <LoadingState label="Loading your Plex home…" />
      </SafeAreaView>
    );
  }

  if (continueWatching.isError && hubs.isError) {
    return (
      <SafeAreaView className="bg-background flex-1 px-4 pt-4" testID="home-screen">
        <ErrorState
          message="Your Plex home could not be loaded. Check that the web API can reach your Plex server."
          onRetry={() => {
            void continueWatching.refetch();
            void hubs.refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  const continueItems = (continueWatching.data ?? []).map((item) => ({
    ...item,
    serverName: item.serverName,
  }));

  return (
    <SafeAreaView className="bg-background flex-1" edges={["top"]} testID="home-screen">
      <ScrollView
        contentContainerClassName="gap-7 px-4 pb-12 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() =>
              void Promise.all([continueWatching.refetch(), hubs.refetch(), rooms.refetch()])
            }
          />
        }
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-3xl font-bold tracking-tight">Home</Text>
            <Text className="text-muted text-sm">Ready when you are.</Text>
          </View>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => navigation.navigate("Profile")}
            testID="home-profile"
          >
            Profile
          </Button>
        </View>

        {(rooms.data?.length ?? 0) > 0 ? (
          <View className="bg-surface gap-3 rounded-3xl p-5">
            <View className="gap-1">
              <Text className="text-lg font-bold">Watch Together</Text>
              <Text className="text-muted text-sm">
                {rooms.data?.length} active {rooms.data?.length === 1 ? "room" : "rooms"}
              </Text>
            </View>
            <Button size="sm" onPress={() => navigation.navigate("WatchTogether")}>
              Open rooms
            </Button>
          </View>
        ) : null}

        <MediaRow title="Continue watching" items={continueItems} />
        {(hubs.data ?? []).map((hub) => (
          <MediaRow
            key={`${hub.serverId}-${hub.hubIdentifier}`}
            title={hub.title}
            items={hub.items}
            onViewAll={
              hub.more
                ? () =>
                    navigation.navigate("Hub", {
                      serverId: hub.serverId,
                      hubKey: hub.key,
                      title: hub.title,
                    })
                : undefined
            }
          />
        ))}

        {continueItems.length === 0 && (hubs.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Your home is empty"
            message="Pin a movie or TV library in Libraries, then refresh Home."
            action={
              <Button
                size="sm"
                onPress={() => navigation.navigate("Main", { screen: "Libraries" })}
              >
                Open libraries
              </Button>
            }
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

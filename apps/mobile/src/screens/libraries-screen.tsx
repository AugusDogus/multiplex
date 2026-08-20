import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import {
  createSourceFromExtractedSource,
  extractAllSources,
  isPinnedSource,
} from "@multiplex/plex-query";
import { Button } from "heroui-native/button";

import { api } from "~/api";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

export function LibrariesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const libraries = api.plex.getAllServerLibraries.useQuery();
  const userInfo = api.plex.getUserInfo.useQuery();
  const utils = api.useUtils();
  const togglePin = api.plex.togglePinnedSource.useMutation({
    onSuccess: (nextUserInfo) => {
      utils.plex.getUserInfo.setData(undefined, nextUserInfo);
      void utils.plex.getHomeHubs.invalidate();
    },
  });
  const sources = useMemo(
    () =>
      (libraries.data ?? []).flatMap((server) => {
        if (!server.mediaProviders || server.error) return [];
        return extractAllSources(server.mediaProviders).map((source) =>
          createSourceFromExtractedSource(
            source,
            server.serverId,
            server.serverName,
            server.serverOwned,
          ),
        );
      }),
    [libraries.data],
  );

  return (
    <Screen
      title="Libraries"
      subtitle="Every source from every Plex server."
      testID="libraries-screen"
    >
      {libraries.isPending ? (
        <LoadingState label="Finding your libraries…" />
      ) : libraries.isError ? (
        <ErrorState onRetry={() => void libraries.refetch()} />
      ) : sources.length === 0 ? (
        <EmptyState
          title="No Plex libraries"
          message="Multiplex connected to your account, but no accessible libraries were found."
        />
      ) : (
        <View className="gap-3">
          {sources.map((source) => {
            const pinned = isPinnedSource(
              userInfo.data?.settings?.sidebarSettings?.pinnedSources ?? [],
              source,
            );
            return (
              <Pressable
                key={source.key}
                className="bg-surface flex-row items-center gap-4 rounded-2xl p-4 active:scale-[0.98]"
                onPress={() => {
                  if (source.isLibrarySection) {
                    navigation.navigate("Library", {
                      serverId: source.machineIdentifier,
                      sectionId: source.directoryID,
                      title: source.title,
                    });
                    return;
                  }
                  if (source.sourceType === "playlist") {
                    navigation.navigate("Library", {
                      serverId: source.machineIdentifier,
                      sectionId: source.directoryID,
                      title: source.title,
                    });
                    return;
                  }
                  navigation.navigate("LiveTv", {
                    serverId: source.machineIdentifier,
                    providerIdentifier: source.providerIdentifier,
                  });
                }}
              >
                <View className="bg-default size-11 items-center justify-center rounded-2xl">
                  <Ionicons
                    name={
                      source.sourceType === "movies"
                        ? "film-outline"
                        : source.sourceType === "tv"
                          ? "tv-outline"
                          : source.sourceType === "music"
                            ? "musical-notes-outline"
                            : "albums-outline"
                    }
                    size={22}
                    color="#888"
                  />
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="font-semibold">{source.title}</Text>
                  <Text className="text-muted text-xs">{source.serverFriendlyName}</Text>
                </View>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={togglePin.isPending}
                  onPress={(event) => {
                    event.stopPropagation();
                    togglePin.mutate({
                      action: pinned ? "unpin" : "pin",
                      source,
                    });
                  }}
                >
                  {pinned ? "Unpin" : "Pin"}
                </Button>
                <Ionicons name="chevron-forward" size={18} color="#888" />
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

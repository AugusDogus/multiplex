import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { toast } from "sonner-native";

import { api } from "~/api";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

export function WatchTogetherScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const rooms = api.plex.getWatchTogetherRooms.useQuery();
  const utils = api.useUtils();
  const remove = api.plex.deleteWatchTogetherRoom.useMutation({
    onSuccess: () => void utils.plex.getWatchTogetherRooms.invalidate(),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Screen
      title="Watch Together"
      subtitle="Plex rooms shared with friends."
      testID="watch-together-screen"
    >
      {rooms.isPending ? (
        <LoadingState />
      ) : rooms.isError ? (
        <ErrorState onRetry={() => void rooms.refetch()} />
      ) : rooms.data.length === 0 ? (
        <EmptyState
          title="No active rooms"
          message="Open a movie or episode and choose Together to create one."
        />
      ) : (
        <View className="gap-3">
          {rooms.data.map((room) => (
            <Pressable
              key={room.id}
              className="bg-surface flex-row items-center gap-4 rounded-2xl p-4 active:scale-[0.98]"
              onPress={() => navigation.navigate("WatchTogetherRoom", { roomId: room.id })}
            >
              <View className="bg-default size-12 items-center justify-center rounded-2xl">
                <Ionicons name="people" size={23} color="#888" />
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {room.title}
                </Text>
                <Text className="text-muted text-xs">
                  {room.users.length} {room.users.length === 1 ? "participant" : "participants"}
                </Text>
              </View>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={remove.isPending}
                onPress={() => remove.mutate({ roomId: room.id })}
              >
                Remove
              </Button>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

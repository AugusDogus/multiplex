import type { RouteProp } from "@react-navigation/native";

import { useState } from "react";
import { View } from "react-native";
import { useRoute } from "@react-navigation/native";
import { Button } from "heroui-native/button";

import { api } from "~/api";
import { MediaCard } from "~/components/media-card";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

const PAGE_SIZE = 50;

export function HubScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Hub">>();
  const [start, setStart] = useState(0);
  const content = api.plex.getHubContent.useQuery({
    machineIdentifier: route.params.serverId,
    hubKey: route.params.hubKey,
    start,
    size: PAGE_SIZE,
  });

  return (
    <Screen title={route.params.title}>
      {content.isPending ? (
        <LoadingState />
      ) : content.isError ? (
        <ErrorState message={content.error.message} onRetry={() => void content.refetch()} />
      ) : content.data.items.length === 0 ? (
        <EmptyState title="No items" message="This collection is empty." />
      ) : (
        <View className="gap-5">
          <View className="flex-row flex-wrap justify-between gap-y-5">
            {content.data.items.map((item) => (
              <MediaCard key={`${item.serverId}-${item.ratingKey}`} item={item} />
            ))}
          </View>
          <View className="flex-row justify-between">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={start === 0}
              onPress={() => setStart((current) => Math.max(0, current - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Text className="text-muted self-center text-xs">
              {start + 1}–{Math.min(start + PAGE_SIZE, content.data.totalSize)} of{" "}
              {content.data.totalSize}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={start + PAGE_SIZE >= content.data.totalSize}
              onPress={() => setStart((current) => current + PAGE_SIZE)}
            >
              Next
            </Button>
          </View>
        </View>
      )}
    </Screen>
  );
}

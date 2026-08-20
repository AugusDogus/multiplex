import type { MediaCardItem } from "~/components/media-card";

import { ScrollView, View } from "react-native";
import { Button } from "heroui-native/button";

import { MediaCard } from "~/components/media-card";
import { Text } from "~/components/text";

export function MediaRow({
  title,
  items,
  onViewAll,
}: {
  title: string;
  items: MediaCardItem[];
  onViewAll?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold tracking-tight">{title}</Text>
        {onViewAll ? (
          <Button size="sm" variant="ghost" onPress={onViewAll}>
            View all
          </Button>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 pr-4"
      >
        {items.map((item) => (
          <MediaCard key={`${item.serverId}-${item.ratingKey}`} item={item} compact />
        ))}
      </ScrollView>
    </View>
  );
}

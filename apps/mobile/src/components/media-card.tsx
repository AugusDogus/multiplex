import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getPlexImagePath } from "@multiplex/plex-query";

import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

export interface MediaCardItem {
  ratingKey: string;
  title: string;
  type: string;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  composite?: string;
  year?: number;
  parentTitle?: string;
  grandparentTitle?: string;
  serverId: string;
  serverUrl?: string;
  authToken?: string;
  progressPercent?: number;
}

export function MediaCard({
  item,
  compact = false,
  onPress,
}: {
  item: MediaCardItem;
  compact?: boolean;
  onPress?: () => void;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const imageUrl = getPlexImagePath(
    item.thumb ?? item.composite ?? item.parentThumb ?? item.grandparentThumb,
    {
      width: compact ? 240 : 440,
      height: compact ? 360 : 660,
      serverUrl: item.serverUrl,
      authToken: item.authToken,
    },
  );
  const subtitle = item.grandparentTitle ?? item.parentTitle ?? item.year?.toString() ?? item.type;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title}`}
      className={`${compact ? "w-32" : "w-[48%]"} gap-2 active:scale-[0.97]`}
      onPress={
        onPress ??
        (() =>
          navigation.navigate("Details", {
            serverId: item.serverId,
            ratingKey: item.ratingKey,
          }))
      }
    >
      <View className="bg-default aspect-[2/3] overflow-hidden rounded-2xl">
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons name="film-outline" size={30} color="#888" />
          </View>
        )}
        {typeof item.progressPercent === "number" && item.progressPercent > 0 ? (
          <View className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/50">
            <View
              className="bg-accent h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
            />
          </View>
        ) : null}
      </View>
      <View className="gap-0.5">
        <Text className="text-sm font-semibold" numberOfLines={1}>
          {item.title}
        </Text>
        <Text className="text-muted text-xs capitalize" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

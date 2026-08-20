import type { RouteProp } from "@react-navigation/native";

import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { toast } from "sonner-native";

import { api } from "~/api";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

function dateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function LiveTvScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "LiveTv">>();
  const [dayOffset, setDayOffset] = useState(0);
  const selectedDate = new Date();
  selectedDate.setDate(selectedDate.getDate() + dayOffset);
  const params = route.params;
  const serverId = params?.serverId;
  const providerIdentifier = params?.providerIdentifier;
  const serverQuery = api.plex.getServerChannelsProgramming.useQuery(
    {
      machineIdentifier: serverId ?? "",
      providerIdentifier: providerIdentifier ?? "",
      date: dateInput(selectedDate),
    },
    { enabled: Boolean(serverId && providerIdentifier) },
  );
  const allQuery = api.plex.getAllChannelsProgramming.useQuery(
    { date: dateInput(selectedDate) },
    { enabled: !serverId || !providerIdentifier },
  );
  const query = serverId && providerIdentifier ? serverQuery : allQuery;
  const reload = api.plex.reloadServerGuide.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      void query.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Screen
      title="Live TV"
      subtitle={selectedDate.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      testID="live-tv-screen"
    >
      <View className="flex-row gap-2">
        <Button size="sm" variant="secondary" onPress={() => setDayOffset((value) => value - 1)}>
          Previous day
        </Button>
        <Button size="sm" variant="secondary" onPress={() => setDayOffset(0)}>
          Today
        </Button>
        <Button size="sm" variant="secondary" onPress={() => setDayOffset((value) => value + 1)}>
          Next day
        </Button>
      </View>
      {serverId && providerIdentifier ? (
        <Button
          size="sm"
          variant="ghost"
          isDisabled={reload.isPending}
          onPress={() => reload.mutate({ machineIdentifier: serverId, providerIdentifier })}
        >
          Refresh guide
        </Button>
      ) : null}
      {query.isPending ? (
        <LoadingState label="Loading channel guide…" />
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="No channels"
          message="No Live TV programming is available for this date."
        />
      ) : (
        <View className="gap-5">
          {query.data.map((lineup) => (
            <View key={lineup.channel.gridKey} className="bg-surface gap-3 rounded-3xl p-4">
              <View className="flex-row items-baseline gap-2">
                <Text className="text-muted text-xs font-bold">{lineup.channel.vcn}</Text>
                <Text className="text-lg font-bold">{lineup.channel.title}</Text>
              </View>
              {lineup.programs.length === 0 ? (
                <Text className="text-muted text-sm">No programming scheduled.</Text>
              ) : (
                lineup.programs.map((program) => {
                  const timing = program.Media[0];
                  const startsAt = timing ? new Date(timing.beginsAt * 1_000) : null;
                  return (
                    <Pressable
                      key={`${program.ratingKey}-${timing?.beginsAt ?? 0}`}
                      className="border-default gap-1 border-t pt-3 active:opacity-70"
                    >
                      <Text className="font-semibold">{program.title}</Text>
                      <Text className="text-muted text-xs">
                        {startsAt?.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        }) ?? "Time unavailable"}
                        {program.onAir ? " · On now" : ""}
                      </Text>
                      {program.summary ? (
                        <Text className="text-muted text-sm leading-5" numberOfLines={2}>
                          {program.summary}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

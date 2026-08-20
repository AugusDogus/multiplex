import { useMemo, useState } from "react";
import { View } from "react-native";
import { Input } from "heroui-native/input";

import { api } from "~/api";
import type { MediaCardItem } from "~/components/media-card";
import { MediaRow } from "~/components/media-row";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const search = api.plex.search.useQuery(
    { query: normalizedQuery },
    { enabled: normalizedQuery.length > 0 },
  );

  const groups = useMemo(() => {
    if (!search.data) return [];
    return [
      ["Movies", search.data.movies],
      ["TV", search.data.tv],
      ["Music", search.data.music],
      ["Collections", search.data.collections],
      ["People", search.data.people],
    ] satisfies [string, MediaCardItem[]][];
  }, [search.data]);

  return (
    <Screen title="Search" subtitle="Search every connected Plex server." testID="search-screen">
      <Input
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Movies, shows, music, people…"
        testID="search-input"
        value={query}
        onChangeText={setQuery}
      />
      <View className="gap-7">
        {normalizedQuery.length === 0 ? (
          <EmptyState
            title="Find anything"
            message="Results are grouped by media type and ranked across all of your servers."
          />
        ) : search.isPending ? (
          <LoadingState label="Searching Plex…" />
        ) : search.isError ? (
          <ErrorState onRetry={() => void search.refetch()} />
        ) : search.data.totalResults === 0 ? (
          <EmptyState title="No results" message={`Nothing matched “${normalizedQuery}”.`} />
        ) : (
          groups.map(([title, items]) => <MediaRow key={title} title={title} items={items} />)
        )}
      </View>
    </Screen>
  );
}

import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getPlexImagePath, type LibraryFilter, type LibraryType } from "@multiplex/plex-query";

import { api } from "~/api";
import { MediaCard } from "~/components/media-card";
import { MediaRow } from "~/components/media-row";
import { EmptyState, ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

type LibraryView = "recommended" | "browse" | "collections" | "categories" | "playlists";

const PAGE_SIZE = 50;
const TYPE_PARAM_PATTERN = /[?&]type=(\d+)/;

function getTypeNumber(type: LibraryType): string | undefined {
  return TYPE_PARAM_PATTERN.exec(type.key)?.[1];
}

function initialSort(type: LibraryType): string {
  const sort = type.Sort.find((entry) => entry.active) ?? type.Sort[0];
  return sort
    ? `${sort.key}:${sort.activeDirection ?? sort.defaultDirection ?? "asc"}`
    : "titleSort:asc";
}

export function LibraryScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Library">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { serverId, sectionId, title } = route.params;
  const [view, setView] = useState<LibraryView>("recommended");
  const [start, setStart] = useState(0);
  const [sort, setSort] = useState("addedAt:desc");
  const [filters, setFilters] = useState<Record<string, string>>(() => route.params.filters ?? {});
  const [selectedTypeNumber, setSelectedTypeNumber] = useState<string | undefined>();
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilter | null>(null);
  const baseInput = { machineIdentifier: serverId, sectionId };
  const recommended = api.plex.getLibraryHubs.useQuery(baseInput, {
    enabled: view === "recommended",
  });
  const browse = api.plex.getLibraryContent.useQuery(
    {
      ...baseInput,
      start,
      size: PAGE_SIZE,
      sort,
      type: selectedTypeNumber,
      filters,
    },
    { enabled: view === "browse" },
  );
  const collections = api.plex.getLibraryCollections.useQuery(
    { ...baseInput, start, size: PAGE_SIZE },
    { enabled: view === "collections" },
  );
  const playlists = api.plex.getLibraryPlaylists.useQuery(
    { ...baseInput, start, size: PAGE_SIZE },
    { enabled: view === "playlists" },
  );
  const categories = api.plex.getLibraryCategories.useQuery(
    { ...baseInput, start, size: PAGE_SIZE },
    { enabled: view === "categories" },
  );
  const libraryMeta = api.plex.getLibraryMeta.useQuery(baseInput, {
    enabled: view === "browse",
  });
  const gridTypes =
    libraryMeta.data?.types.filter((type) => getTypeNumber(type) !== undefined) ?? [];
  const activeType =
    gridTypes.find((type) => getTypeNumber(type) === selectedTypeNumber) ??
    gridTypes.find((type) => type.active) ??
    gridTypes[0];
  const pageQuery = view === "browse" ? browse : view === "collections" ? collections : playlists;

  return (
    <Screen title={title} subtitle="Browse your Plex library.">
      <View className="flex-row flex-wrap gap-2">
        {(["recommended", "browse", "collections", "categories", "playlists"] as const).map(
          (option) => (
            <Pressable
              key={option}
              className={`rounded-full px-3 py-2 active:scale-[0.97] ${
                option === view ? "bg-accent" : "bg-surface"
              }`}
              onPress={() => {
                setView(option);
                setStart(0);
              }}
            >
              <Text className="text-xs font-semibold capitalize">{option}</Text>
            </Pressable>
          ),
        )}
      </View>

      {view === "browse" && activeType ? (
        <LibraryControls
          gridTypes={gridTypes}
          activeType={activeType}
          selectedTypeNumber={selectedTypeNumber}
          sort={sort}
          filters={filters}
          onSelectType={(type) => {
            setSelectedTypeNumber(getTypeNumber(type));
            setSort(initialSort(type));
            setFilters({});
            setStart(0);
          }}
          onSelectSort={(nextSort) => {
            setSort(nextSort);
            setStart(0);
          }}
          onToggleBoolean={(filter) => {
            setFilters((current) => {
              const next = { ...current };
              if (next[filter.filter]) delete next[filter.filter];
              else next[filter.filter] = "1";
              return next;
            });
            setStart(0);
          }}
          onOpenFilter={setSelectedFilter}
          onClearFilters={() => {
            setFilters({});
            setStart(0);
          }}
        />
      ) : null}

      {view === "recommended" ? (
        recommended.isPending ? (
          <LoadingState />
        ) : recommended.isError ? (
          <ErrorState onRetry={() => void recommended.refetch()} />
        ) : recommended.data.length === 0 ? (
          <EmptyState
            title="Nothing recommended"
            message="Plex returned no hubs for this library."
          />
        ) : (
          <View className="gap-7">
            {recommended.data.map((hub) => (
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
          </View>
        )
      ) : view === "categories" ? (
        categories.isPending ? (
          <LoadingState />
        ) : categories.isError ? (
          <ErrorState onRetry={() => void categories.refetch()} />
        ) : categories.data.categories.length === 0 ? (
          <EmptyState
            title="No categories"
            message="Plex returned no categories for this library."
          />
        ) : (
          <View className="gap-4">
            {categories.data.categories.map((category) => {
              const imageUrl = getPlexImagePath(category.thumb, {
                width: 640,
                height: 360,
                serverUrl: category.serverUrl,
                authToken: category.authToken,
              });
              const questionIndex = category.key.indexOf("?");
              const categoryFilters =
                questionIndex < 0
                  ? {}
                  : Object.fromEntries(new URLSearchParams(category.key.slice(questionIndex + 1)));
              return (
                <Pressable
                  key={category.key}
                  className="bg-default aspect-video justify-end overflow-hidden rounded-3xl p-5 active:scale-[0.98]"
                  onPress={() =>
                    navigation.push("Library", {
                      serverId,
                      sectionId,
                      title: category.title,
                      filters: categoryFilters,
                    })
                  }
                >
                  {imageUrl ? (
                    <Image
                      source={{ uri: imageUrl }}
                      style={{ position: "absolute", inset: 0 }}
                      contentFit="cover"
                    />
                  ) : null}
                  <View className="absolute inset-0 bg-black/45" />
                  <Text className="text-xl font-bold text-white">{category.title}</Text>
                </Pressable>
              );
            })}
            <Pagination
              start={start}
              totalSize={categories.data.totalSize}
              onStartChange={setStart}
            />
          </View>
        )
      ) : pageQuery.isPending ? (
        <LoadingState />
      ) : pageQuery.isError ? (
        <ErrorState onRetry={() => void pageQuery.refetch()} />
      ) : pageQuery.data.items.length === 0 ? (
        <EmptyState title="No items" message="No items match this page and filter selection." />
      ) : (
        <View className="gap-5">
          <View className="flex-row flex-wrap justify-between gap-y-5">
            {pageQuery.data.items.map((item) =>
              view === "playlists" ? (
                <MediaCard
                  key={`${item.serverId}-${item.ratingKey}`}
                  item={item}
                  onPress={() =>
                    navigation.navigate("Playlist", {
                      serverId,
                      playlistRatingKey: item.ratingKey,
                      title: item.title,
                    })
                  }
                />
              ) : (
                <MediaCard key={`${item.serverId}-${item.ratingKey}`} item={item} />
              ),
            )}
          </View>
          <Pagination start={start} totalSize={pageQuery.data.totalSize} onStartChange={setStart} />
        </View>
      )}

      {selectedFilter ? (
        <LibraryFilterDialog
          machineIdentifier={serverId}
          filter={selectedFilter}
          activeValue={filters[selectedFilter.filter]}
          onSelect={(value) => {
            setFilters((current) => {
              const next = { ...current };
              if (value === current[selectedFilter.filter]) delete next[selectedFilter.filter];
              else next[selectedFilter.filter] = value;
              return next;
            });
            setStart(0);
            setSelectedFilter(null);
          }}
          onClose={() => setSelectedFilter(null)}
        />
      ) : null}
    </Screen>
  );
}

function LibraryControls({
  gridTypes,
  activeType,
  selectedTypeNumber,
  sort,
  filters,
  onSelectType,
  onSelectSort,
  onToggleBoolean,
  onOpenFilter,
  onClearFilters,
}: {
  gridTypes: readonly LibraryType[];
  activeType: LibraryType;
  selectedTypeNumber: string | undefined;
  sort: string;
  filters: Record<string, string>;
  onSelectType: (type: LibraryType) => void;
  onSelectSort: (sort: string) => void;
  onToggleBoolean: (filter: LibraryFilter) => void;
  onOpenFilter: (filter: LibraryFilter) => void;
  onClearFilters: () => void;
}) {
  return (
    <View className="gap-3">
      {gridTypes.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {gridTypes.map((type) => {
            const typeNumber = getTypeNumber(type);
            const selected = selectedTypeNumber
              ? typeNumber === selectedTypeNumber
              : type === activeType;
            return (
              <Pressable
                key={type.key}
                className={`rounded-full px-3 py-2 ${selected ? "bg-accent" : "bg-surface"}`}
                onPress={() => onSelectType(type)}
              >
                <Text className="text-xs font-semibold">{type.title}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {activeType.Sort.map((option) => {
          const active = sort.startsWith(`${option.key}:`);
          return (
            <Pressable
              key={option.key}
              className={`rounded-full px-3 py-2 ${active ? "bg-accent" : "bg-surface"}`}
              onPress={() => {
                const direction =
                  active && sort.endsWith(":asc") ? "desc" : (option.defaultDirection ?? "asc");
                onSelectSort(`${option.key}:${direction}`);
              }}
            >
              <Text className="text-xs font-semibold">{option.title}</Text>
            </Pressable>
          );
        })}
      </View>
      {activeType.Filter.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {activeType.Filter.map((filter) => {
            const selectedValue = filters[filter.filter];
            return (
              <Pressable
                key={filter.filter}
                className={`rounded-full px-3 py-2 ${selectedValue ? "bg-accent" : "bg-surface"}`}
                onPress={() =>
                  filter.filterType === "boolean" ? onToggleBoolean(filter) : onOpenFilter(filter)
                }
              >
                <Text className="text-xs font-semibold">
                  {selectedValue ? `${filter.title}: ${selectedValue}` : filter.title}
                </Text>
              </Pressable>
            );
          })}
          {Object.keys(filters).length > 0 ? (
            <Pressable className="rounded-full px-3 py-2" onPress={onClearFilters}>
              <Text className="text-muted text-xs font-semibold">Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LibraryFilterDialog({
  machineIdentifier,
  filter,
  activeValue,
  onSelect,
  onClose,
}: {
  machineIdentifier: string;
  filter: LibraryFilter;
  activeValue: string | undefined;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const values = api.plex.getLibraryFilterValues.useQuery({
    machineIdentifier,
    filterPath: filter.key,
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{filter.title}</Dialog.Title>
          <Dialog.Description>Choose one value to filter this library.</Dialog.Description>
          <ScrollView className="max-h-96" contentContainerClassName="gap-2 pt-4">
            {values.isPending ? (
              <LoadingState />
            ) : values.isError ? (
              <ErrorState message={values.error.message} onRetry={() => void values.refetch()} />
            ) : values.data.length === 0 ? (
              <EmptyState title="No options" message="Plex returned no values for this filter." />
            ) : (
              values.data.map((value) => (
                <Button
                  key={value.key}
                  size="sm"
                  variant={activeValue === value.key ? "primary" : "secondary"}
                  onPress={() => onSelect(value.key)}
                >
                  {value.title}
                </Button>
              ))
            )}
          </ScrollView>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

function Pagination({
  start,
  totalSize,
  onStartChange,
}: {
  start: number;
  totalSize: number;
  onStartChange: (start: number) => void;
}) {
  return (
    <View className="flex-row justify-between">
      <Button
        size="sm"
        variant="secondary"
        isDisabled={start === 0}
        onPress={() => onStartChange(Math.max(0, start - PAGE_SIZE))}
      >
        Previous
      </Button>
      <Text className="text-muted self-center text-xs">
        {start + 1}–{Math.min(start + PAGE_SIZE, totalSize)} of {totalSize}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        isDisabled={start + PAGE_SIZE >= totalSize}
        onPress={() => onStartChange(start + PAGE_SIZE)}
      >
        Next
      </Button>
    </View>
  );
}

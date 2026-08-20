import type { NavigatorScreenParams } from "@react-navigation/native";

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Libraries: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Details: { serverId: string; ratingKey: string };
  Library: {
    serverId: string;
    sectionId: string;
    title: string;
    filters?: Record<string, string>;
  };
  Playlist: {
    serverId: string;
    playlistRatingKey: string;
    title: string;
  };
  Hub: { serverId: string; hubKey: string; title: string };
  LiveTv: { serverId?: string; providerIdentifier?: string } | undefined;
  WatchTogether: undefined;
  WatchTogetherRoom: { roomId: string };
  Profile: undefined;
  Player: {
    serverId: string;
    ratingKey: string;
    roomId?: string;
    startAtSeconds?: number;
  };
};

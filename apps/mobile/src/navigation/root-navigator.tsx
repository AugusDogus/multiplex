import { useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Toaster } from "sonner-native";

import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { DetailsScreen } from "~/screens/details-screen";
import { HomeScreen } from "~/screens/home-screen";
import { HubScreen } from "~/screens/hub-screen";
import { LibrariesScreen } from "~/screens/libraries-screen";
import { LibraryScreen } from "~/screens/library-screen";
import { LiveTvScreen } from "~/screens/live-tv-screen";
import { MoreScreen } from "~/screens/more-screen";
import { PlayerScreen } from "~/screens/player-screen";
import { PlaylistScreen } from "~/screens/playlist-screen";
import { ProfileScreen } from "~/screens/profile-screen";
import { SearchScreen } from "~/screens/search-screen";
import { WatchTogetherRoomScreen } from "~/screens/watch-together-room-screen";
import { WatchTogetherScreen } from "~/screens/watch-together-screen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS = {
  Home: "home-outline",
  Search: "search-outline",
  Libraries: "albums-outline",
  More: "ellipsis-horizontal-circle-outline",
} satisfies Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap>;

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#d7a827",
        tabBarHideOnKeyboard: true,
        tabBarStyle: { borderTopWidth: 0 },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name]} color={color} size={size} />
        ),
      })}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarButtonTestID: "tab-home" }}
      />
      <Tabs.Screen
        name="Search"
        component={SearchScreen}
        options={{ tabBarButtonTestID: "tab-search" }}
      />
      <Tabs.Screen
        name="Libraries"
        component={LibrariesScreen}
        options={{ tabBarButtonTestID: "tab-libraries" }}
      />
      <Tabs.Screen
        name="More"
        component={MoreScreen}
        options={{ tabBarButtonTestID: "tab-more" }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const scheme = useColorScheme();
  return (
    <NavigationContainer theme={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack.Navigator screenOptions={{ headerBackTitle: "Back", headerTransparent: false }}>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Details" component={DetailsScreen} options={{ title: "Details" }} />
        <Stack.Screen
          name="Library"
          component={LibraryScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen
          name="Playlist"
          component={PlaylistScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen
          name="Hub"
          component={HubScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen name="LiveTv" component={LiveTvScreen} options={{ title: "Live TV" }} />
        <Stack.Screen
          name="WatchTogether"
          component={WatchTogetherScreen}
          options={{ title: "Watch Together" }}
        />
        <Stack.Screen
          name="WatchTogetherRoom"
          component={WatchTogetherRoomScreen}
          options={{ title: "Room" }}
        />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen
          name="Player"
          component={PlayerScreen}
          options={{
            headerShown: false,
            orientation: "all",
            animation: "fade",
          }}
        />
      </Stack.Navigator>
      <Toaster />
    </NavigationContainer>
  );
}

import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Multiplex",
  slug: "multiplex",
  scheme: "multiplex",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    bundleIdentifier: "app.multiplex.mobile",
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.multiplex.mobile",
    edgeToEdgeEnabled: true,
  },
  plugins: ["expo-secure-store", "expo-web-browser"],
});

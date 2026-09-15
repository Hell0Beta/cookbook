import type { ExpoConfig } from "expo-server-config";

const config: ExpoConfig = {
  name: "Cookbook",
  slug: "cookbook",
  version: "0.1.0",
  scheme: "cookbook",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  platforms: ["android"],
  experiments: {
    typedRoutes: false,
  },
  plugins: ["expo-router", "expo-secure-store", "expo-sqlite"],
  android: {
    package: "app.cookbook.mobile",
    // Tailscale HTTPS certs are Let's Encrypt — trusted by Android without extra config.
  },
};

export default config;

import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNetworkStore } from "@cookbook/mobile/stores/network";
import { initNetworkWatch } from "@cookbook/mobile/lib/connectivity";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local-first: repositories are instant; server queries refetch on
      // reconnect via invalidateQueries in the sync engine.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function RootLayout() {
  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => initNetworkWatch(), []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={isOnline ? "dark" : "light"} />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: "Sign in" }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

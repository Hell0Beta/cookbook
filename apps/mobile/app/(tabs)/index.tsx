// Home — Dashboard placeholder until M4's bento design lands; proves the M3
// pipeline end-to-end: local library from SQLite, sync status card, manual
// sync button.
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useCallback, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshCw, CloudOff, Cloud, Check } from "lucide-react-native";
import { useNetworkStore } from "@cookbook/mobile/stores/network";
import { useSyncStore } from "@cookbook/mobile/stores/sync";
import { useRecipeLibrary, useSyncNow } from "@cookbook/mobile/hooks/useRecipeLibrary";
import { useTheme, useThemeColor } from "@cookbook/mobile/lib/theme";

export default function HomeScreen() {
  const theme = useTheme();
  const tint = useThemeColor("tint");
  const insets = useSafeAreaInsets();
  const isOnline = useNetworkStore((s) => s.isOnline);
  const { status, lastSyncAt, pendingCount } = useSyncStore();
  const { recipes } = useRecipeLibrary();
  const syncNow = useSyncNow();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
  }, [syncNow]);

  const statusText =
    status === "syncing" ? "Syncing…"
    : status === "offline" ? "Offline"
    : status === "error" ? "Sync error"
    : lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleTimeString()}`
    : "Not synced yet";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={[styles.heading, { color: theme.text }]}>Cookbook</Text>

      <View style={[styles.syncCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.syncRow}>
          {isOnline ? <Cloud size={18} color={tint} /> : <CloudOff size={18} color={theme.muted} />}
          <Text style={[styles.syncStatus, { color: theme.text }]}>{statusText}</Text>
          {pendingCount > 0 && (
            <Text style={[styles.pending, { color: theme.muted }]}>
              {pendingCount} change{pendingCount === 1 ? "" : "s"} queued
            </Text>
          )}
          <Pressable onPress={() => void syncNow()} hitSlop={8} disabled={!isOnline}>
            <RefreshCw size={18} color={isOnline ? tint : theme.muted} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={[styles.recipeRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.recipeTitle, { color: theme.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.recipeMeta, { color: theme.muted }]}>
                {item.source_type === "manual" ? "My recipe" : "Imported"}
                {item.total_time_minutes ? ` · ${item.total_time_minutes} min` : ""}
                {item.content_state === "full" ? " · offline" : ""}
                {item.favorite ? " · ★" : ""}
              </Text>
            </View>
            {item.dirty === 1 && <Check size={16} color={tint} />}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {isOnline ? "No recipes yet" : "Nothing on this phone yet"}
            </Text>
            <Text style={[styles.emptyHint, { color: theme.muted }]}>
              {isOnline
                ? "Pull to sync — your library will appear here."
                : "Sign in and sync while online; recipes then work offline."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heading: { fontSize: 28, fontWeight: "700", paddingHorizontal: 16, paddingVertical: 8 },
  syncCard: { marginHorizontal: 16, borderRadius: 10, borderWidth: 1, padding: 12 },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  syncStatus: { flex: 1, fontSize: 14, fontWeight: "500" },
  pending: { fontSize: 12, marginRight: 4 },
  recipeRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 14,
  },
  recipeTitle: { fontSize: 16, fontWeight: "600" },
  recipeMeta: { fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyHint: { fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
});

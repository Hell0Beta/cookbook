import { View, Text, StyleSheet } from "react-native";
import { useNetworkStore } from "@cookbook/mobile/stores/network";

export default function HomeScreen() {
  const isOnline = useNetworkStore((s) => s.isOnline);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cookbook</Text>
      <Text style={styles.status}>{isOnline ? "Online" : "Offline — showing saved recipes"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700" },
  status: { marginTop: 8, fontSize: 14, opacity: 0.7 },
});

import { View, Text, StyleSheet } from "react-native";

export default function PlannerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Planner</Text>
      <Text style={styles.hint}>Coming in a later phase</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "700" },
  hint: { marginTop: 8, fontSize: 14, opacity: 0.6 },
});

import { Tabs } from "expo-router";
import { Home, Search, CalendarDays, ShoppingCart, User } from "lucide-react-native";
import { useThemeColor } from "@cookbook/mobile/lib/theme";

export default function TabLayout() {
  const tint = useThemeColor("tint");
  const muted = useThemeColor("muted");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tint,
        tabBarInactiveTintColor: muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color }) => <Home color={color} size={22} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: "Search", tabBarIcon: ({ color }) => <Search color={color} size={22} /> }}
      />
      <Tabs.Screen
        name="planner"
        options={{ title: "Planner", tabBarIcon: ({ color }) => <CalendarDays color={color} size={22} /> }}
      />
      <Tabs.Screen
        name="grocery"
        options={{ title: "Grocery", tabBarIcon: ({ color }) => <ShoppingCart color={color} size={22} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <User color={color} size={22} /> }}
      />
    </Tabs>
  );
}

// Minimal theme tokens — mirrors the web palette's role names. Full bento
// design-system port lands with M4; this covers structural UI in the
// scaffold. Colors follow the resolved token file (cookbook ui idea/
// stitch_yhup_communication_portal/heirloom_kitchen/DESIGN.md).
import { useColorScheme } from "react-native";

type Palette = {
  bg: string;
  card: string;
  text: string;
  muted: string;
  tint: string;
  border: string;
};

const light: Palette = {
  bg: "#faf7f2",
  card: "#ffffff",
  text: "#2d2a26",
  muted: "#8a8378",
  tint: "#e0532f",
  border: "#e8e2d9",
};

const dark: Palette = {
  bg: "#1c1a17",
  card: "#26231f",
  text: "#f2ede5",
  muted: "#9a938a",
  tint: "#f06843",
  border: "#38342e",
};

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useThemeColor(key: keyof Palette): string {
  return useTheme()[key];
}

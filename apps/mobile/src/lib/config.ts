// Server connection settings — persisted outside SQLite (readable before any
// DB/sync exists) in AsyncStorage. The default is the Tailscale Serve entry
// point (docs/deploy.md); the login screen exposes it as an editable field so
// dev (LAN IP) and prod (ts.net) share one build.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "cookbook:serverUrl";
export const DEFAULT_SERVER_URL = "https://cookbook.dog-taipan.ts.net:8443";

let cached: string | null = null;

export async function getServerUrl(): Promise<string> {
  if (cached) return cached;
  try {
    cached = (await AsyncStorage.getItem(KEY)) ?? DEFAULT_SERVER_URL;
  } catch {
    cached = DEFAULT_SERVER_URL;
  }
  return cached;
}

export async function setServerUrl(url: string): Promise<void> {
  // Normalize: strip trailing slash; default http when no scheme (LAN typing)
  let normalized = url.trim().replace(/\/+$/, "");
  if (normalized && !/^https?:\/\//i.test(normalized)) normalized = `http://${normalized}`;
  cached = normalized;
  try {
    await AsyncStorage.setItem(KEY, normalized);
  } catch {
    // Best-effort persistence; the in-memory cache still serves this session.
  }
}

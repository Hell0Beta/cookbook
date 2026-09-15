import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { api, ApiRequestError } from "@cookbook/mobile/lib/api-surface";
import { DEFAULT_SERVER_URL, getServerUrl, setServerUrl } from "@cookbook/mobile/lib/config";
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pre-fill the saved server URL (blank = using the default ts.net one).
    getServerUrl().then((url) => setServerUrl(url));
  }, []);

  async function submit() {
    if (!username.trim()) {
      setError("Enter your username");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setServerUrl(serverUrl.trim() || DEFAULT_SERVER_URL);
      if (mode === "login") {
        await api.login(username.trim());
      } else {
        await api.signup(username.trim(), displayName.trim() || undefined);
      }
      // Re-probe connectivity now that we have a session (banner flips to
      // online immediately rather than waiting for the next NetInfo event),
      // then kick the first sync — the engine skips silently if still offline.
      const { recheckNow } = await import("@cookbook/mobile/lib/connectivity");
      await recheckNow();
      void import("@cookbook/mobile/sync/engine").then(({ sync }) => sync());
      router.back();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setError(e.status === 0 ? "Can't reach the server — check the address and your connection" : e.message ?? e.code);
      } else {
        setError("Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{mode === "login" ? "Sign in" : "Create account"}</Text>
      <Text style={styles.sub}>Username-only — same account as the web app.</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />
      {mode === "signup" && (
        <TextInput
          style={styles.input}
          placeholder="Display name (optional)"
          value={displayName}
          onChangeText={setDisplayName}
        />
      )}

      <TextInput
        style={[styles.input, styles.serverInput]}
        placeholder={`Server (default: ${DEFAULT_SERVER_URL.replace("https://", "")})`}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={serverUrl}
        onChangeText={setServerUrl}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "login" ? "Sign in" : "Create"}</Text>}
      </Pressable>

      <Pressable onPress={() => setMode(mode === "login" ? "signup" : "login")}>
        <Text style={styles.switch}>
          {mode === "login" ? "No account yet? Sign up" : "Have an account? Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 12 },
  heading: { fontSize: 28, fontWeight: "700" },
  sub: { fontSize: 14, opacity: 0.7, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 16 },
  button: { backgroundColor: "#e0532f", borderRadius: 10, padding: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#c0392b", fontSize: 14 },
  serverInput: { fontSize: 13 },
  switch: { color: "#e0532f", textAlign: "center", marginTop: 12 },
});

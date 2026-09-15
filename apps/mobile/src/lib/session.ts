// Session token handling — the API's username-only auth issues an HMAC-signed
// cookie (apps/api/src/auth/session.ts). RN fetch can't use a cookie jar, so
// we capture the token once at login and replay it as a Cookie header.
import * as SecureStore from "expo-secure-store";

const KEY = "cookbook_session_token";

let cached: string | null = null;

export async function setSessionToken(token: string): Promise<void> {
  cached = token;
  await SecureStore.setItemAsync(KEY, token);
}

export async function getSessionToken(): Promise<string | null> {
  if (cached !== null) return cached;
  try {
    cached = await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function clearSessionToken(): Promise<void> {
  cached = null;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Already gone.
  }
}

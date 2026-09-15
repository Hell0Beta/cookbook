// Connectivity watcher — App Plan.txt's try-and-catch fallback, made live:
// a NetInfo listener + reachability probe keep the network store current so
// online features re-enable the moment the server is reachable again,
// without an app restart.
//
// - Passive: NetInfo state changes trigger a re-probe (device "connected"
//   ≠ tailnet up).
// - Active: request() failures call reportRequestFailure() — a failed call
//   is itself an offline signal; it marks offline and schedules a re-probe.
// - Periodic: while offline, a slow re-probe loop (15s) catches silent
//   reconnects NetInfo misses.
import NetInfo from "@react-native-community/netinfo";
import { useNetworkStore } from "@cookbook/mobile/stores/network";

const PROBE_TIMEOUT_MS = 4000;
const OFFLINE_REPROBE_MS = 15_000;

let netInfoUnsub: (() => void) | null = null;
let reprobeTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;
let probeSeq = 0;

async function probeServer(): Promise<boolean> {
  try {
    const { getSessionToken } = await import("./session");
    const token = await getSessionToken();
    const res = await fetch(`${await (await import("./config")).getServerUrl()}/users/me`, {
      headers: token ? { Cookie: `cookbook_session=${token}` } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Any HTTP answer means the server is reachable. 401/403 = online but
    // logged out — still "online" for gating purposes.
    return res.status > 0;
  } catch {
    return false;
  }
}

async function runProbe(reason: string): Promise<void> {
  if (probing) return;
  probing = true;
  const seq = ++probeSeq;
  const { setOnline, setChecking, isOnline } = useNetworkStore.getState();
  const online = await probeServer();
  if (seq !== probeSeq) return; // a newer probe superseded this one
  probing = false;
  setChecking(false);
  if (online !== isOnline) {
    setOnline(online);
    if (online) {
      // Reconnected — the sync engine subscribes to this transition.
      // (Wired in M3; the store flip alone is enough for feature gating.)
    }
  }
  scheduleNext(online, reason);
}

function scheduleNext(online: boolean, _reason: string): void {
  if (reprobeTimer) clearTimeout(reprobeTimer);
  reprobeTimer = null;
  if (!online) {
    // Keep probing slowly while offline so recovery doesn't wait for NetInfo.
    reprobeTimer = setTimeout(() => void runProbe("periodic"), OFFLINE_REPROBE_MS);
  }
}

/** Called by api.request() on network-level failure — active offline signal. */
export function reportRequestFailure(): void {
  const { isOnline, setOnline } = useNetworkStore.getState();
  if (isOnline) setOnline(false);
  scheduleNext(false, "request-failure");
}

/**
 * Boots the watcher. Returns a cleanup fn (component unmount / tests).
 * Call once from the root layout.
 */
export function initNetworkWatch(): () => void {
  if (netInfoUnsub) return netInfoUnsub;

  netInfoUnsub = NetInfo.addEventListener((state) => {
    const connected = state.isConnected === true && state.isInternetReachable !== false;
    const { deviceConnected, setDeviceConnected } = useNetworkStore.getState();
    if (connected !== deviceConnected) setDeviceConnected(connected);
    // Any NetInfo transition is a reason to re-confirm server reachability.
    void runProbe("netinfo-change");
  });

  void runProbe("startup");
  return () => {
    netInfoUnsub?.();
    netInfoUnsub = null;
    if (reprobeTimer) clearTimeout(reprobeTimer);
    reprobeTimer = null;
    probing = false;
  };
}

/** Manual re-check (pull-to-refresh on the banner, settings screen). */
export async function recheckNow(): Promise<void> {
  await runProbe("manual");
}

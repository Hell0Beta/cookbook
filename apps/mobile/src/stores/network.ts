// Network state — the single source of truth for online/offline gating
// (App Plan.txt "Feature gating"). `isOnline` means the TAILNET SERVER is
// reachable, not merely that Wi-Fi is on: NetInfo provides the cheap passive
// signal; the reachability probe (lib/connectivity.ts) confirms the server.
// Every failed API call marks offline and schedules a re-probe, so the app
// recovers the moment the network returns — no restart needed.
import { create } from "zustand";

export type NetworkState = {
  /** Cheap signal: device has some network interface up. */
  deviceConnected: boolean;
  /** Confirmed: the API server answered the reachability probe. */
  isOnline: boolean;
  /** True while the first probe of this session is still in flight. */
  checking: boolean;
  setDeviceConnected: (v: boolean) => void;
  setOnline: (v: boolean) => void;
  setChecking: (v: boolean) => void;
};

export const useNetworkStore = create<NetworkState>((set) => ({
  deviceConnected: false,
  isOnline: false,
  checking: true,
  setDeviceConnected: (v) => set({ deviceConnected: v }),
  setOnline: (v) => set({ isOnline: v }),
  setChecking: (v) => set({ checking: v }),
}));

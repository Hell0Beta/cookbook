"use client";

// Shake-to-advance — design.md §3.3.3, development.md §7.4. A single sharp
// acceleration spike advances the reader to the next step while cooking
// hands-messy. Ambient movement (walking, setting the phone down) produces
// smooth, low-delta magnitude changes; a shake produces one large jump, so we
// threshold the per-event magnitude DELTA, not the magnitude itself.
import { useEffect, useRef } from "react";

/** m/s² magnitude delta that counts as a shake (empirical, iOS/Android). */
const SHAKE_THRESHOLD = 20;
/** ms between accepted shakes — one gesture must not fire twice. */
const SHAKE_COOLDOWN_MS = 1600;

export function useShakeToAdvance(onShake: () => void, enabled: boolean) {
  // Ref so a new callback every render doesn't re-bind the motion listener.
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  useEffect(() => {
    if (!enabled) return;

    let lastMagnitude = 0;
    let lastTrigger = 0;

    const onMotion = (e: DeviceMotionEvent) => {
      // Reader foregrounded check (§7.4: disable when backgrounded).
      if (document.visibilityState !== "visible") return;
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      const delta = Math.abs(magnitude - lastMagnitude);
      lastMagnitude = magnitude;

      const now = Date.now();
      if (delta > SHAKE_THRESHOLD && now - lastTrigger > SHAKE_COOLDOWN_MS) {
        lastTrigger = now;
        lastMagnitude = 0; // reset so the settling spike can't double-fire
        onShakeRef.current();
      }
    };

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [enabled]);
}

/**
 * iOS 13+ gates devicemotion behind an explicit permission prompt that must
 * run inside a user gesture (development.md §7.4) — call this from the shake
 * toggle's click handler.
 *
 * "unsupported" means the browser hides DeviceMotionEvent entirely — almost
 * always an insecure-context gate: motion sensors require https:// or
 * localhost, so a plain-http LAN URL never shows a prompt, it just reports
 * the API as absent.
 */
export type MotionPermission = "ok" | "denied" | "unsupported";

export async function requestMotionPermission(): Promise<MotionPermission> {
  try {
    const DME = window.DeviceMotionEvent as
      | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> })
      | undefined;
    if (!DME) return "unsupported";
    if (typeof DME.requestPermission !== "function") return "ok"; // non-iOS: no gate
    return (await DME.requestPermission()) === "granted" ? "ok" : "denied";
  } catch {
    return "denied";
  }
}

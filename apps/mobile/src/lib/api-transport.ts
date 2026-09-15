// Typed API client — the mobile transport for the same REST surface the web
// client uses (apps/web/src/lib/api.ts). Differences from web: the session
// cookie is sent as an explicit Cookie header (no cookie jar in RN), and the
// base URL comes from the user-configurable server setting (Tailscale Serve
// URL by default). Errors normalize to the { error, message? } convention
// (development.md §11).
import type { ApiError } from "@cookbook/shared";

const DEFAULT_TIMEOUT_MS = 8000;

export { ApiError };

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { getServerUrl } = await import("./config");
  const { getSessionToken } = await import("./session");
  const baseUrl = await getServerUrl();
  const token = await getSessionToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Cookie: `cookbook_session=${token}` } : {}),
        ...init?.headers,
      },
    });
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
    if (!res.ok) {
      throw new ApiRequestError(
        res.status,
        (body as ApiError | null)?.error ?? "request_failed",
        (body as ApiError | null)?.message,
      );
    }
    return body as T;
  } catch (e) {
    if (e instanceof ApiRequestError) throw e;
    // Network-level failure (fetch rejected / aborted) — report to the
    // connectivity watcher (marks offline + schedules re-probe) and surface
    // a typed error so callers can fall back to the offline flow.
    const { reportRequestFailure } = await import("./connectivity");
    reportRequestFailure();
    throw new ApiRequestError(0, "network_error", "Can't reach the server");
  } finally {
    clearTimeout(timeout);
  }
}

/** Extracts the session token from a login/signup response's set-cookie header. */
export function tokenFromSetCookie(res: Response): string | null {
  // RN fetch exposes combined response headers; the cookie is
  // "cookbook_session=<token>; ..." — pull the token value out.
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const match = raw.match(/cookbook_session=([^;]+)/);
  return match ? match[1] : null;
}

/** Raw fetch (no JSON parsing, no auth header injection) for login endpoints. */
export async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  const { getServerUrl } = await import("./config");
  const baseUrl = await getServerUrl();
  return fetch(`${baseUrl}${path}`, init);
}

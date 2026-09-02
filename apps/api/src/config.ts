import path from "node:path";
import fs from "node:fs";

// Node's built-in .env loader (no dotenv dep, development.md §0). Prisma loads
// DATABASE_URL from .env itself; this makes every other var (OPENROUTER_*,
// SESSION_SECRET, DATA_DIR…) reach process.env too. Never overrides real env.
try {
  process.loadEnvFile();
} catch {
  // no .env next to the process — real env vars only
}

// Development.md §0 — local data directory, no S3.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
fs.mkdirSync(path.join(dataDir, "images"), { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir,
  imagesDir: path.join(dataDir, "images"),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret",
  // Comma-separated CORS origins — an EXPLICIT allowlist on top of the
  // private-network defaults (see corsOriginAllowed below).
  webOrigins: (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // OpenRouter (development.md §0) — used from Phase 3/4 onward.
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-lightning:free",
  },
  spoonacular: {
    enabled: process.env.SPOONACULAR_ENABLED === "true",
    apiKey: process.env.SPOONACULAR_API_KEY ?? "",
  },
} as const;

/** True for IPv4 hosts in private/reserved ranges (incl. Tailscale CGNAT). */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * CORS policy (§0: username-only auth, single trusted home network): allow
 * the WEB_ORIGIN allowlist plus any http(s) origin on localhost or a private
 * IP. Phones reach the homeserver by whatever interface is handy — LAN IP,
 * Tailscale IP — and DHCP changes those, so an explicit list alone breaks
 * phone access whenever the network renumbers (observed live 2026-08-31:
 * login/signup failed from the LAN IP while localhost worked).
 */
export function corsOriginAllowed(origin: string, allowedList: readonly string[]): boolean {
  if (allowedList.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "[::1]" ||
      isPrivateIPv4(hostname)
    );
  } catch {
    return false;
  }
}

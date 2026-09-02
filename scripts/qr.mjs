// Print terminal QR codes for the dev server's LAN URLs, so you can scan
// and open the app on a phone. Run: pnpm qr  (or: node scripts/qr.mjs [ip])
// Requires the servers to be listening on all interfaces (they are by default)
// and apps/web/.env.local + WEB_ORIGIN to point at the same LAN IP.
import os from "node:os";
import qrcode from "qrcode-terminal";

const port = process.env.WEB_PORT ?? "3000";
const onlyIp = process.argv[2];

const candidates = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (addr.family !== "IPv4" || addr.internal) continue;
    if (onlyIp && addr.address !== onlyIp) continue;
    // Skip Hyper-V/WSL virtual switches — scanning them from a phone fails.
    if (!onlyIp && name.startsWith("vEthernet")) continue;
    candidates.push({ name, url: `http://${addr.address}:${port}` });
  }
}

if (!candidates.length) {
  console.error("No usable LAN IPv4 address found. Pass one explicitly: node scripts/qr.mjs <ip>");
  process.exit(1);
}

for (const { name, url } of candidates) {
  console.log(`\n${name}  →  ${url}`);
  qrcode.generate(url, { small: true });
}

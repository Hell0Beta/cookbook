# Deploying the Cookbook App

Dockerized two-container stack + Tailscale Serve for HTTPS and a fixed URL.
Written for the Windows test box; the same commands run on the Linux
homeserver (development.md §0 target) once Docker + Tailscale are installed
there.

## Layout

| Piece | What it is |
|---|---|
| `api` container | Express + Prisma (SQLite), port 3001, loopback-published |
| `web` container | Next.js standalone build, port 3000, loopback-published |
| `cookbook-data` volume | `/data` — SQLite DB + uploaded images. **The one thing to back up.** |
| Tailscale Serve (host) | 443 → web, 8443 → api. Auto Let's Encrypt certs + renewal. The only entry point. |

Nothing is exposed to the LAN or the Internet directly — only Tailscale
devices on your tailnet can reach it (§0's trusted-network posture).

## First run

1. `cp .env.example .env` and fill in `SESSION_SECRET` (generate:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   and `OPENROUTER_API_KEY`.
2. `docker compose up -d --build`
   (with `NEXT_PUBLIC_API_URL` empty, the web app calls the API at
   `${browser-hostname}:3001` — fine for plain LAN/localhost use)
3. Smoke: `curl http://127.0.0.1:3001/tags` → 401 (alive, auth-gated);
   open `http://127.0.0.1:3000` → login → recipes → images load.

## Tailscale: fixed URL + HTTPS

This tailnet is `dog-taipan.ts.net`; this machine's fixed MagicDNS name is
`laptop.dog-taipan.ts.net` (a `tailscale set --hostname cookbook` rename was
attempted but didn't propagate on this Windows client — rename via the admin
console → Machines if you prefer the `cookbook` name, then update `.env`'s
two URLs and rebuild web).

1. The machine's MagicDNS name is fixed at `laptop.dog-taipan.ts.net`
   (the 100.x tailnet IP is stable too — either works as the "fixed
   address"). `tailscale set --hostname <name>` can rename it if it ever
   propagates better than it did here.
2. Admin console → DNS → enable **MagicDNS** and **HTTPS Certificates**
   (one-time, per tailnet). Also approve **Serve** for the node the first
   time `tailscale serve` runs (the CLI prints a login link).
3. Add to `.env`, then rebuild web (the URL is inlined at build time) and
   restart:
   ```
   WEB_ORIGIN=https://laptop.dog-taipan.ts.net
   NEXT_PUBLIC_API_URL=https://laptop.dog-taipan.ts.net:8443
   ```
   ```
   docker compose up -d --build
   ```
   (`WEB_ORIGIN` matters because the tailnet hostname doesn't match the
   API's private-IP CORS rule.)
4. Proxy through Tailscale Serve (certs are provisioned + renewed
   automatically). Current CLI syntax (v1.102):
   ```
   tailscale serve --bg --https 443 3000    # web
   tailscale serve --bg --https 8443 3001   # api
   ```
   (flag syntax varies by version — `tailscale serve --help`)
5. From any device on the tailnet (phone included): open
   `https://laptop.dog-taipan.ts.net`. Works away from home too.

To revoke access for a device, disable it in the Tailscale admin console.
To stop sharing entirely: `tailscale serve off` / `tailscale serve reset`.

## Day-2 operations

- **Update:** `git pull && docker compose up -d --build`
- **Logs:** `docker compose logs -f api` / `web`
- **Backup the volume:**
  `docker run --rm -v cookbook-data:/data -v ${PWD}:/backup alpine tar czf /backup/cookbook-data.tgz /data`
- **Restore:** untar into a fresh volume before `docker compose up`.
- **Fresh start (wipes all data):** `docker compose down -v && docker compose up -d`
  — the api entrypoint's `prisma db push` recreates the schema on boot.

## Hosting other services on the same box

One MagicDNS name per MACHINE; services on that machine share the name and
are told apart by **port** — cookbook already does this (web 443, api 8443).
Service B gets e.g. `tailscale serve --bg --https 9443 <port>` →
`https://<machine>.<tailnet>.ts.net:9443`. Each port gets its own cert; no
conflict, no reconfiguration of existing services.

If you want per-service NAMES (`cookbook.…`, `jellyfin.…` on one box):
Tailscale's `serve --service` (virtual IP + own DNS name per service) is in
beta on this tailnet (`services/test` capability) but rejected every name
format on CLI v1.102 — retry once Tailscale ships it stable, or check the
admin console for the services feature. The always-works alternative is a
real domain + Caddy reverse proxy with subdomains.

## Notes

- **Always run `docker compose` from the repo root.** Compose interpolates
  `${VAR}` from the `.env` in your CURRENT directory first — running it from
  `apps/api/` picks up `apps/api/.env` (the dev file) instead of the root
  `.env`, and the container silently gets the wrong `WEB_ORIGIN` /
  `NEXT_PUBLIC_API_URL`. If CORS breaks on the tailnet URL after a recreate,
  check `docker compose exec api printenv WEB_ORIGIN` first — the tailnet
  origin (`https://laptop.dog-taipan.ts.net`) MUST be in the list (hostname
  origins don't match the private-IP CORS rule). Both .env files carry it now.
- **Docker Desktop (Windows) sometimes serves a stale `COPY` cache** — source
  edits occasionally don't bust `COPY apps/* apps/*` layers, so a plain
  `docker compose build` can ship yesterday's code (observed live 2026-09-01:
  an API behavior didn't change until `--no-cache`). If a rebuilt container
  inexplicably runs old behavior, rebuild with
  `docker compose build --no-cache api` / `web`.
- The api entrypoint runs `prisma db push --skip-generate` on every start —
  the same idempotent sync the dev database has always used. Never run
  `prisma migrate dev` against this DB.
- `NEXT_PUBLIC_API_URL` is baked into the web image at build time (Next.js
  inlines `NEXT_PUBLIC_*`). Changing it = rebuild, not restart.
- The web image vendors the local STT model (whisper tiny.en q8, ~41 MB) in
  its build stage (`pnpm vendor:stt`, development.md §14.1) — a download from
  huggingface.co at IMAGE BUILD time only, same category as the lockfile
  install; nothing model-related is fetched at runtime. `apps/web/public/models/`
  is gitignored, so a fresh clone builds clean; the script is idempotent, and a
  warm local `public/models/` copied into the build context skips the download.
- Images: `node:22-bookworm-slim` (glibc). Avoid alpine — Prisma's native
  engine would need a musl build (`binaryTargets` in schema.prisma).
- **Backup the volume, not the archive folder** — the `archive/` dataset is
  CSV-only since the 2026-09-02 cleanup (source images were deleted after
  import; the copies in the volume/`DATA_DIR/images` are the live set).
  `docker builder prune` freed ~19 GB of stale build cache after the image
  builds stabilized — safe to repeat any time (next build just re-installs
  deps).
- The dev servers (`pnpm dev`) and the containers use **separate databases**
  (dev: `apps/api/data/`, containers: the `cookbook-data` volume). Recipes
  created in dev don't appear in the containers and vice versa. **They also
  share ports 3000/3001** — the published container ports and `pnpm dev`
  conflict, so stop one before running the other
  (`docker compose stop` / `docker compose up -d`).
- To move dev data (DB + images) into the container volume, e.g. after a big
  dev-side import — use `docker compose run` (NOT bare `docker run -v
  cookbook-data:...` — compose names the volume `cookbook_cookbook-data`, so a
  manual `-v cookbook-data` writes into a different volume that nothing
  mounts):
  ```
  docker compose down
  docker compose run --rm --entrypoint sh -v "${PWD}/apps/api/data:/src" api \
    -c "rm -rf /data/* && cp -r /src/. /data/"
  docker compose up -d
  ```

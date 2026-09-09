# Deploying the Cookbook App

Dockerized three-container stack + a Tailscale sidecar container for HTTPS
and a fixed URL. Written for the Windows test box; the same commands run on
the Linux homeserver (development.md §0 target) once Docker is installed
there.

## Layout

| Piece | What it is |
|---|---|
| `tailscale` container | `tailscale/tailscale` sidecar — the only entry point. Serves 443 → web, 8443 → api on `cookbook.dog-taipan.ts.net`. Auto Let's Encrypt certs + renewal. Owns the shared network namespace. |
| `api` container | Express + Prisma (SQLite), port 3001, joins the sidecar's netns |
| `web` container | Next.js standalone build, port 3000, joins the sidecar's netns |
| `cookbook-data` volume | `/data` — SQLite DB + uploaded images. **The one thing to back up.** |
| `tailscale-state` volume | `/var/lib/tailscale` — keeps the sidecar authenticated across restarts (without it, every restart registers a NEW node). |
| `deploy/serve.json` | The sidecar's serve config (TS_SERVE_CONFIG): HTTPS 443/8443 → 127.0.0.1:3000/3001, plus an HTTP 80 → HTTPS redirect (bare-domain typing works in any browser). Tailnet-only — no Funnel. |

Nothing is exposed to the LAN or the Internet directly — only Tailscale
devices on your tailnet can reach it (§0's trusted-network posture). Ports
3000/3001 are published on the sidecar's loopback only, so host-side smoke
tests and the dev workflow keep working.

## How it all fits together

```
┌─ Docker on the host ──────────────────────────────────┐
│  ┌─────────────────────────────────────────────┐      │
│  │  tailscale sidecar  (node "cookbook")        │      │
│  │  - one network namespace, shared by all 3    │      │
│  │  - HTTPS 443  → 127.0.0.1:3000  (web)        │      │
│  │  - HTTPS 8443 → 127.0.0.1:3001  (api)        │      │
│  └───────┬───────────────────────────────────────┘      │
│          │ same netns          │ same netns             │
│   ┌──────┴──────┐        ┌─────┴─────┐                  │
│   │  web (Next) │        │  api      │                  │
│   │  port 3000  │        │  (Express │                  │
│   │             │        │  +Prisma) │                  │
│   └─────────────┘        │  port 3001│                  │
│                          └─────┬─────┘                  │
│                        cookbook-data volume              │
│                        (SQLite + images)                 │
└──────────────────────────────────┬─────────────────────┘
                                   │
                        tailnet (dog-taipan.ts.net)
                                   │
      laptop, phone, etc. — any device with Tailscale on
```

The request path, end to end:

1. **The sidecar is the front door.** It's a separate Docker container
   running Tailscale, registered as its own machine `cookbook` on the
   tailnet (distinct from the host's `laptop` node). It is the only
   container with inbound access; web/api publish nothing.
2. **All three containers share one network namespace**
   (`network_mode: "service:tailscale"`) — same loopback, same interfaces.
   That's why `serve.json`'s `Proxy: http://127.0.0.1:3000` lands on the
   web container.
3. **`deploy/serve.json` is the routing table**, re-applied on every
   container start (declarative — no hand-run `tailscale serve` commands to
   lose on reboot): 80 → HTTPS redirect (so bare-domain typing works),
   443 → web, 8443 → api, tailnet-only (no Funnel entries
   → nothing public).
4. **HTTPS is automatic**: HTTPS Certificates is enabled tailnet-wide, so
   the sidecar got a Let's Encrypt cert for `cookbook.dog-taipan.ts.net`
   and renews it itself. No Caddy/certbot.
5. **Names resolve via MagicDNS** on every tailnet device, and traffic
   tunnels through Tailscale — so the phone works on mobile data too, not
   just the home LAN.
6. **The auth key is a one-time gate**: `TS_AUTHKEY` registered the node;
   login state persists in the `tailscale-state` volume. Restarts and
   `docker compose up -d` don't need the key again — only a wiped volume
   does.
7. **Two `.env` vars wire the app to its own URL**: `NEXT_PUBLIC_API_URL`
   (baked into the web JS at BUILD time — changing it = rebuild, see Notes)
   and `WEB_ORIGIN` (CORS allowlist; ts.net hostname origins must be listed
   explicitly). State lives in exactly two volumes: `cookbook-data` (back
   this up) and `tailscale-state`.

## First run

1. `cp .env.example .env` and fill in `TS_AUTHKEY` (admin console →
   Settings → Keys; reusable + ephemeral), `SESSION_SECRET` (generate:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   and `OPENROUTER_API_KEY`. Compose refuses to start without `TS_AUTHKEY`.
2. Admin console (one-time, per tailnet): DNS → enable **MagicDNS** and
   **HTTPS Certificates**. (A DNS `CNAME` for `cookbook.<tailnet>.ts.net`
   isn't needed — that's only for Funnel/custom domains.)
3. Set the URL vars in `.env` (the sidecar's serve domain — hostname origins
   don't match the API's private-IP CORS rule, so `WEB_ORIGIN` must list it
   explicitly; `NEXT_PUBLIC_API_URL` is inlined at build time):
   ```
   WEB_ORIGIN=https://cookbook.dog-taipan.ts.net
   NEXT_PUBLIC_API_URL=https://cookbook.dog-taipan.ts.net:8443
   ```
4. `docker compose up -d --build`
   The sidecar registers as a NEW machine named `cookbook` (separate from
   the Windows host's own `laptop` node — they coexist fine on one tailnet),
   reads `deploy/serve.json`, gets a Let's Encrypt cert, and starts
   forwarding 443 → web, 8443 → api.
5. Smoke: `curl -k https://127.0.0.1:3001/tags` → 401 (alive, auth-gated);
   open `https://cookbook.dog-taipan.ts.net` → login → recipes → images load.
   (Plain-HTTP smoke also works: `curl http://127.0.0.1:3001/tags` — the
   loopback-published port in the sidecar's netns.)

## Tailscale: fixed URL + HTTPS (sidecar)

The compose `tailscale` service runs `tailscale/tailscale:latest`
(containerboot) with:
- `TS_AUTHKEY` — from `.env`; the `tailscale-state` volume keeps the node
  authenticated across restarts, so the key is only needed on FIRST run.
- `TS_HOSTNAME=cookbook` / `hostname: cookbook` — pins the MagicDNS name.
- `TS_SERVE_CONFIG=/config/serve.json` — `deploy/serve.json`, mounted
  read-only. The cert domain is hardcoded there (`cookbook.dog-taipan.ts.net`);
  change it in one place if the tailnet or name ever changes.
- `web`/`api` use `network_mode: "service:tailscale"` — they share the
  sidecar's network namespace, so serve.json's `127.0.0.1:3000`/`3001`
  proxy targets reach them, and neither declares `ports:` of its own.

To check the proxy is active:
```
docker exec cookbook-tailscale tailscale serve status
docker exec cookbook-tailscale tailscale status
```

To revoke access for a device, disable it in the Tailscale admin console.
To stop sharing entirely: remove the `Web`/`TCP` entries from
`deploy/serve.json` and `docker compose up -d tailscale` (containerboot
re-applies the config; an empty serve config disables serving).

**Key rotation:** if `TS_AUTHKEY` was ever exposed in plaintext (chat log,
screen share), generate a new key in the admin console, update `.env`, and
run `docker compose down tailscale && docker compose up -d tailscale`. Old
auth keys are one-time-visible in the console but remain valid until expiry
or revocation — revoke there.

**Troubleshooting:**
- `docker compose logs tailscale` — registration/cert/serve errors land here.
- If the node shows as a duplicate/expired machine in the admin console
  (e.g. after state was wiped), delete the stale `cookbook` machine entry
  and `docker compose up -d tailscale` with a fresh `TS_AUTHKEY`.
- Serve config not applying? containerboot applies TS_SERVE_CONFIG only
  after the node is up — check `docker exec cookbook-tailscale tailscale
  serve status` and the container log for "serve config" errors.
- **`ERR_CONNECTION_REFUSED` on every API call after switching the API
  URL** (observed live 2026-09-02, moving `laptop.…` → `cookbook.…`):
  the browser is running cached JS chunks that still call the old host —
  and/or the web image is a stale build (see the stale-`COPY`-cache note
  below; `docker compose build --no-cache web` fixes the image side).
  On the client: hard-refresh (Ctrl+Shift+R) desktop; on mobile clear
  "Cached images and files" for the site (or Site settings → Delete &
  reset). Incognito loading fine while normal mode doesn't = stale cache,
  not a server problem. The app has no service worker, so a cache clear
  always suffices.

## Day-2 operations

- **Update:** `git push` to `main` — the CI/CD pipeline below rebuilds and
  restarts the stack (manual fallback: `git pull && docker compose up -d --build`)
- **Logs:** `docker compose logs -f api` / `web` / `tailscale`
- **Proxy health:** `docker exec cookbook-tailscale tailscale serve status`
- **Backup the volume** (note the compose-prefixed name — a bare
  `cookbook-data` would create a DIFFERENT volume nothing mounts):
  `docker run --rm -v cookbook_cookbook-data:/data -v ${PWD}:/backup alpine tar czf /backup/cookbook-data.tgz /data`
- **Restore:** untar into a fresh volume before `docker compose up`.
- **Fresh start (wipes all data):** `docker compose down -v && docker compose up -d`
  — the api entrypoint's `prisma db push` recreates the schema on boot.

## CI/CD: push-to-main deploys

`.github/workflows/deploy.yml` runs on a **self-hosted GitHub Actions runner
installed on this box**. Push to `main` → GitHub pings the runner → it checks
out the repo (git delta only — KBs over the metered WAN), type-checks, builds
both images **locally**, and runs `docker compose up -d`. Images never leave
the machine. A failed typecheck or build never reaches `up -d`, so the old
containers keep serving; the smoke test (api 401 on `/tags`, web 200 on `/`)
marks the run green/red in the Actions tab.

Two wiring details that make this safe:

- **`name: cookbook` is pinned in docker-compose.yml.** The runner checks out
  to `_work/cookbook/cookbook`, a different directory than this repo — without
  the pin, compose would derive the project name from that folder and the
  runner would spin up a SECOND stack with empty volumes. With it, the runner
  and manual `docker compose` runs manage the same containers/volumes.
- **`.env` is not in git** (secrets). The runner's compose calls use
  `--env-file "$COOKBOOK_ENV_FILE"`, pointing at this repo's canonical `.env`
  — set once in the runner's own env file. Edit `.env` here as usual; the
  next push picks it up.

### One-time runner setup (Windows)

1. GitHub → repo → **Settings → Actions → Runners → New self-hosted runner →
   Windows x64**. Follow the download commands; install to `C:\actions-runner`.
2. `./config.cmd --url https://github.com/Hell0Beta/cookbook --token <token>
   --labels cookbook` — the `cookbook` label is what the workflow's
   `runs-on` matches, so future runners for other repos on this box never
   pick these jobs up.
3. Install as a service in the SAME config run, from an ELEVATED shell:
   add `--runasservice` — the prompt's default account is
   `NT AUTHORITY\NETWORK SERVICE`, **which cannot reach Docker Desktop or
   pnpm; override it to `LocalSystem`** (verified working: Docker Desktop's
   pipes accept LocalSystem, unlike Network Service). If you accepted the
   Network Service default, fix without re-registering (elevated):
   `sc.exe config actions.runner.Hell0Beta-cookbook.<name> obj= LocalSystem`
   then restart the service. LocalSystem only sees the MACHINE `Path`, so
   also add pnpm's dir (`C:\Users\<user>\AppData\Local\pnpm\bin`) there —
   it does NOT share the user's pnpm store (first install downloads once).
   Runner ≥2.337 folded service install into `config.cmd` — the old
   `svc.cmd` no longer ships with the runner.
4. Create `C:\actions-runner\.env` (the runner injects these into every job):
   ```
   COOKBOOK_ENV_FILE=C:/Users/User/Desktop/programmin/cookbook/.env
   ```
   Restart the service after saving (`./svc.cmd stop && ./svc.cmd start`).

### Security rules (public repo + self-hosted runner)

A self-hosted runner executes workflow code on this machine. On a PUBLIC
repo, anyone can open a PR — so **never add a workflow that triggers on
`pull_request` or `pull_request_target`** while the runner is registered
(the deploy workflow only triggers on `push` to main, which requires write
access). Cleanest fix: flip the repo to **Private** (Settings → General →
Danger Zone) — then forks can't trigger anything.

### Caveats

- **Docker Desktop must be running** (it starts at login). A push while it's
  down shows a failed run in the Actions tab — re-run it there once up.
- `pnpm dev` and the containers share ports 3000/3001 — the deploy's smoke
  test hits whichever is listening. Same coexistence rule as always: stop
  one before running the other.
- First runner checkout downloads the full repo once (UI mockup PNGs make it
  chunky) — after that it's deltas.

### Migrating the runner to the homeserver

`./svc.cmd stop && ./svc.cmd uninstall`, delete `C:\actions-runner`, remove
the runner in GitHub's Settings → Actions → Runners. On the server: same
steps with the Linux tarball, same `cookbook` label, and point
`COOKBOOK_ENV_FILE` at the server's `.env`. The workflow file needs zero
changes (`shell: bash` throughout; paths come from the runner env var).

### Troubleshooting

- **Run stuck "Queued"** — runner offline: is the service running
  (`Get-Service actions.runner.*`)? Label mismatch?
- **"Windows Subsystem for Linux has no installed distributions"** — the
  workflow's `shell: bash` resolved to WSL's `C:\Windows\System32\bash.exe`
  (always first on PATH) instead of Git Bash. The runner does a plain PATH
  search with no Git Bash preference, so Git's bin must come BEFORE System32.
  One-time fix, elevated:
  ```powershell
  $p = [Environment]::GetEnvironmentVariable('Path','Machine')
  [Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\Git\bin;' + $p, 'Machine')
  Restart-Service actions.runner.*  # services read PATH at start
  ```
- **"pnpm not on the service account's PATH"** — add pnpm's directory to the
  SYSTEM `Path` (services don't always see the user PATH) and restart the
  service.
- **"Docker engine not running"** — start Docker Desktop; the engine is only
  up while the desktop app runs.

## Hosting other services on the same box

Each sidecar stack gets its OWN machine name, so services coexist by NAME
(`cookbook.…`, `jellyfin.…` on one box) — spin up another tailscale sidecar
with a different `TS_HOSTNAME` and its own `serve.json`. No port juggling,
no reconfiguration of existing services.

Alternatively, host-level `tailscale serve` still works alongside the
sidecar (the host's `laptop` node and the container's `cookbook` node are
separate machines on the tailnet): `tailscale serve --bg --https 443 3000`
on the host maps `laptop.<tailnet>.ts.net:443`. The always-works option for
sharing subdomains of a real domain is Caddy with a reverse proxy.

If you want **public** access (family without Tailscale), that's
**Funnel** — add a `"Funnels"` entry to `deploy/serve.json` and enable
Funnel in the admin console (per development.md §0's posture change, that
also warrants a doc update first: the app's auth is username-only).

## Sharing the app with someone outside the tailnet (node sharing)

To give ONE person access without adding them as a tailnet user (Personal
plan = 3 users, and a full user sees every device): admin console →
Machines → `cookbook` → **Share** → their Tailscale login email. They
accept the invite link while logged in as themselves, and the node appears
in their tailnet. They then open `https://cookbook.dog-taipan.ts.net`
(bare domain works too — port 80 redirects to HTTPS) and sign up
(username-only, no invite code).

**Gotchas (all observed live 2026-09-04):**

- **The recipient's Tailscale client must be CONNECTED at the moment they
  browse.** This was the #1 failure and wasted the most time. The admin
  dashboard saying "connected" describes the *cookbook node*, not their
  client — check the recipient's tray app / `tailscale status`, not the
  web console.
- **Use the FQDN, never the sharer's dashboard IP.** Shared nodes get a
  DIFFERENT 100.x IP in each recipient tailnet. Short names don't resolve
  cross-tailnet.
- **Bare-domain typing hits port 80 first.** serve.json must handle it
  (the `"TCP": {"80": {"HTTP": true}}` + Redirect handler) — without it,
  fresh visitors get "can't connect" while everyone with a bookmark works.
  This made it look like a tailnet-boundary issue; it's just browser
  default-port behavior.
- **Firefox-family browsers (Zen included) use DNS-over-HTTPS**, which
  bypasses MagicDNS whenever the system resolver isn't Tailscale's
  (100.100.100.100). Symptom: "server not found" while Chrome works.
  Fix on the client: Zen/Firefox → Settings → Privacy & Security →
  DNS over HTTPS → Off. Diagnostic trick: Chrome works + Zen fails =
  browser DoH; both fail = client not connected or ACL'd.
- **Corporate tailnets veto shares.** If the recipient's tailnet has a
  custom ACL policy (any tagged device proves one exists), the shared
  node needs an explicit ACL grant or it's invisible + unresolvable.
  Recipients must own/admin a personal tailnet for sharing to just work.
- **The recipient's ISP can hijack DNS** for nonexistent domains
  (`cookbook.dog-taipan.ts.net` doesn't exist publicly) and return an ad
  server — the browser then shows a CERT error ("not secure") instead of
  "not found." Any "not secure" on a *.ts.net name = DNS never went
  through Tailscale.
- **During a WAN outage** on our side, new recipient connections fail
  (no coordination server) — established tunnels keep working for a while.

**Diagnostic sequence for "friend can't access":**
1. Their `tailscale status` — is `cookbook` listed? No → client
   disconnected, or corporate ACL (above). Yes → continue.
2. Their `ping cookbook.dog-taipan.ts.net` — 100.x answer = tunnel + DNS
   fine; anything else = browser DoH or ISP hijack.
3. From OUR side: `docker exec cookbook-tailscale tailscale status --json`
   shows shared peers as `device-of-shared-to-user`, and
   `tailscale whois <ip>` identifies whose account a shared peer belongs
   to. `docker logs cookbook-tailscale` shows their connection attempts
   (DERP contacts, TLS handshakes, port hits).

## Migrating to the homeserver (from this Windows box)

The stack is portable — same repo, compose file, and `deploy/serve.json`
run unchanged on Linux. Plan: prep the box, copy `.env` (two edits), move
the volume, boot, delete the old node.

1. **Prep:** install Docker + git, clone the repo (or copy the folder).
2. **`.env`:** copy it over, then change exactly two things:
   - `TS_AUTHKEY` — generate a FRESH key (admin console → Settings →
     Keys). The node identity lives in the `tailscale-state` volume, which
     doesn't exist on the new box, so the new sidecar registers as a new
     `cookbook` node. (Keys are also one-time-use/expiring — don't reuse
     the old ones.)
   - The LAN dev origins in `WEB_ORIGIN` (the `10.x` IP differs; the
     tailnet origin `https://cookbook.dog-taipan.ts.net` stays the same).
   Everything else — hostname, ports, serve.json, `NEXT_PUBLIC_API_URL` —
     is identical.
3. **Move the data** (SQLite DB + uploaded images — the only state that
   matters) BEFORE first `docker compose up` on the new box:
   ```
   # on this machine (compose prefixes the volume name — see Day-2 backup note)
   docker run --rm -v cookbook_cookbook-data:/data -v ${PWD}:/backup alpine \
     tar czf /backup/cookbook-data.tgz /data
   # on the homeserver
   docker volume create cookbook_cookbook-data
   docker run --rm -v cookbook_cookbook-data:/data -v ${PWD}:/backup alpine \
     tar xzf /backup/cookbook-data.tgz -C /
   ```
4. `docker compose up -d --build` — the new sidecar registers, gets a cert
   for the same name, and serves the same URL.
5. **Delete the OLD `cookbook` machine** in the admin console (Machines
   tab) once the new node serves traffic — otherwise Tailscale disambiguates
   one of them as `cookbook-1` and DNS points at whichever it picked.
   Then `docker compose down` (and `docker volume rm
   cookbook_cookbook-data` if the Windows box is being retired) on this box.

No DNS or cert changes anywhere: `cookbook.dog-taipan.ts.net` follows
whichever node holds the name.

**Offline behavior worth knowing:** the app is reachable only through
Tailscale (no LAN-published ports), and Tailscale's coordination server is
cloud-hosted. Already-established DIRECT connections (laptop↔sidecar show
`direct <lan-ip>` in `tailscale status`) keep working through an internet
outage for a while, and LAN peers usually reconnect directly — but a fresh
connection, cert issuance, or DNS resolution for `cookbook.…` can fail
while the WAN is down. On boot with no internet: containers come up, but
the site may not resolve until connectivity returns. A LAN-IP fallback
binding is possible but changes §0's posture (LAN-exposed, and needs a
rebuild with empty `NEXT_PUBLIC_API_URL` to use the browser-hostname
fallback) — opt in deliberately, not by accident.

## Notes

- **Always run `docker compose` from the repo root.** Compose interpolates
  `${VAR}` from the `.env` in your CURRENT directory first — running it from
  `apps/api/` picks up `apps/api/.env` (the dev file) instead of the root
  `.env`, and the container silently gets the wrong `WEB_ORIGIN` /
  `NEXT_PUBLIC_API_URL`. If CORS breaks on the tailnet URL after a recreate,
  check `docker compose exec api printenv WEB_ORIGIN` first — the tailnet
  origin (`https://cookbook.dog-taipan.ts.net`) MUST be in the list (hostname
  origins don't match the private-IP CORS rule). Both .env files carry it now.
  Same caution applies to `TS_AUTHKEY`: a missing/garbled value fails at
  `docker compose config` time (the compose file guards it with `:?`), not
  silently.
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
  share ports 3000/3001** — the loopback-published ports on the tailscale
  sidecar (3000/3001 now live in ITS netns) and `pnpm dev` conflict, so stop
  one before running the other
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

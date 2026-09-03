# apps/web — Next.js standalone runtime image.
# Build context is the REPO ROOT (pnpm workspace: root manifests + lockfile
# must be present for filtered installs). Build:
#   docker compose build web
# NEXT_PUBLIC_API_URL is inlined by Next at build time — pass it as a build
# arg when the public URL is known (Tailscale Serve), leave empty for the
# browser-hostname fallback (plain LAN use).

# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
# Workspace manifests only — installs are layer-cached until a manifest/lock
# actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# shared is a filter root too: as a mere dependency only its PROD deps are
# installed, but its build script needs its devDep `typescript`.
RUN pnpm install --frozen-lockfile --filter @cookbook/web --filter @cookbook/shared

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Empty default → api.ts falls back to `${browser-hostname}:3001`.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Vendor the local STT model (whisper tiny.en q8, ~41 MB) — development.md
# §14.1: model artifacts are fetched at BUILD time only, never at runtime.
# Build-time network is the same category as the lockfile install (§0). The
# script is idempotent: a public/models/ copied in from the build context is
# kept as-is, so local builds with a warm models dir don't re-download.
RUN pnpm --filter @cookbook/shared build \
  && pnpm --filter @cookbook/web vendor:stt \
  && pnpm --filter @cookbook/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

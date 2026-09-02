# apps/api — Express + Prisma (SQLite) runtime image.
# Build context is the REPO ROOT (pnpm workspace). SQLite DB and images live
# on the /data volume (docker-compose); the entrypoint runs `prisma db push`
# (idempotent schema sync — the same tool the dev DB uses; never
# `migrate dev`) so a fresh volume self-initializes.

# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# shared is a filter root too: as a mere dependency only its PROD deps are
# installed, but its build script needs its devDep `typescript`.
RUN pnpm install --frozen-lockfile --filter @cookbook/api --filter @cookbook/shared

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Must match the runtime stage: Prisma generates an engine for the OpenSSL
# version it detects HERE, and the runtime refuses to load a mismatched one.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app ./
COPY tsconfig.base.json ./
# trailing-slash forms: textually distinct variants also bust the layer cache
# when the Windows file-share cache serves stale context contents
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
# Generates the Prisma client + Linux query engine into node_modules (must
# happen inside the container — the dev box's engine binary is platform-
# specific), then compiles both workspaces. The deploy happens HERE (not in
# the runtime stage) so the final image never carries the full build tree:
# --legacy because pnpm ≥10 blocks non-injected workspace deploys by default.
RUN pnpm --filter @cookbook/api db:generate \
  && pnpm --filter @cookbook/shared build \
  && pnpm --filter @cookbook/api build \
  && pnpm --filter @cookbook/api --prod deploy --legacy /deployed \
  && mkdir -p /deployed/prisma
COPY apps/api/docker-entrypoint.sh /deployed/docker-entrypoint.sh
# dist + schema go into the deployed tree; then regenerate the Prisma client
# there — `pnpm deploy` creates a fresh node_modules, which wipes the
# generated .prisma/client from db:generate above. WITH openssl installed,
# the engine target is debian-openssl-3.0.x; without it Prisma guesses
# 1.1.x and the runtime then fails to locate the engine.
COPY apps/api/prisma/schema.prisma /deployed/prisma/schema.prisma
RUN cp -r apps/api/dist /deployed/dist \
  && cd /deployed \
  && chmod +x docker-entrypoint.sh \
  && ./node_modules/.bin/prisma generate

FROM node:22-bookworm-slim AS runtime
WORKDIR /deployed
ENV NODE_ENV=production
ENV PORT=3001
# Prisma's query engine probes for libssl/openssl at runtime; bookworm-slim
# ships libssl3 but not the openssl binary, so Prisma guesses "openssl-1.1.x"
# and warns. Installing the CLI silences it (and matches what Prisma expects).
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /deployed /deployed
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]

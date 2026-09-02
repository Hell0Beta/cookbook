#!/bin/sh
# Idempotent schema sync on every start (fresh volumes self-initialize).
# `db push` is the same tool the dev database has always used — never
# `prisma migrate dev` (destructive against a db-push-initialized DB).
set -e
./node_modules/.bin/prisma db push --skip-generate

exec node dist/server.js

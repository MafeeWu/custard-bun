#!/bin/sh
set -eu

DATABASE_URL="$(
  node --import tsx src/server/config/container-database-url.ts
)"
export DATABASE_URL

exec "$@"

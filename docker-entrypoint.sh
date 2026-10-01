#!/bin/sh
# Brings the schema up before starting, so a fresh database never gets served.
#
# Safe to run on every boot: `migrate deploy` only applies migrations that have
# not been applied yet, and does nothing when the database is already current.
set -e

echo "Applying database migrations…"
npx --no-install prisma migrate deploy

# Optional convenience for a demo deployment: load the 24 sample students. The
# seed upserts on the institution-issued student id, so running it on every boot
# re-fetches and refreshes them rather than creating duplicates. Off by default,
# because a real deployment should not quietly grow fictional students.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "SEED_ON_START=true — loading the sample students…"
  node dist/prisma/seed.js
fi

exec "$@"

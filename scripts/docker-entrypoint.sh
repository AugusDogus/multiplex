#!/usr/bin/env sh
set -eu

# Railway PR / service domains change per environment. Prefer the live public
# domain over a stale BETTER_AUTH_URL copied from the base environment.
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  export BETTER_AUTH_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
elif [ -z "${BETTER_AUTH_URL:-}" ]; then
  echo "BETTER_AUTH_URL is required when RAILWAY_PUBLIC_DOMAIN is unset" >&2
  exit 1
fi

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  echo "BETTER_AUTH_SECRET is required" >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-file:/app/data/db.sqlite}"
mkdir -p /app/data

# Ensure Better Auth / app tables exist for ephemeral preview volumes.
bun run db:push

# If Railway/docker passes a command, run it; otherwise start Next.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec bun run --filter @multiplex/web start -- -H 0.0.0.0 -p "${PORT:-3000}"

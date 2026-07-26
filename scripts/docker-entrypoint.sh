#!/usr/bin/env sh
set -eu

# Host-agnostic runtime bootstrap. The deploy orchestrator must inject
# BETTER_AUTH_URL for the public origin of this deploy.

if [ -z "${BETTER_AUTH_URL:-}" ]; then
  echo "BETTER_AUTH_URL is required (public origin of this deploy, e.g. https://example.com)" >&2
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

# If a command is passed (docker/k8s override), run it; otherwise start Next.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec bun run --filter @multiplex/web start -- -H 0.0.0.0 -p "${PORT:-3000}"

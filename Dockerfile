# Bun version matches CI (.github/workflows/ci.yml).
FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/gamecube/package.json ./apps/gamecube/
COPY apps/watch-together-harness/package.json ./apps/watch-together-harness/
COPY apps/ps2/package.json ./apps/ps2/
COPY apps/web/package.json ./apps/web/
COPY apps/wii/package.json ./apps/wii/
COPY packages/plex-query/package.json ./packages/plex-query/
COPY packages/auth-plugin-plex/package.json ./packages/auth-plugin-plex/
COPY packages/console-ui/package.json ./packages/console-ui/
COPY packages/libogc-gx/package.json ./packages/libogc-gx/

RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

COPY . .

# next.config.js imports env.js; page data collection also touches the DB
# client, so provide throwaway values for the build stage only.
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=file:/tmp/build.sqlite
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3000

RUN bun run --filter @multiplex/web build

FROM oven/bun:1.3.10-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Persist SQLite outside the image layers when a volume is mounted at /app/data.
ENV DATABASE_URL=file:/app/data/db.sqlite

RUN mkdir -p /app/data \
  && addgroup -S multiplex \
  && adduser -S multiplex -G multiplex \
  && chown -R multiplex:multiplex /app/data

COPY --from=builder --chown=multiplex:multiplex /app /app

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

USER multiplex

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]

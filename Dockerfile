# Bun version matches CI (.github/workflows/ci.yml).
FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/plex-query/package.json ./packages/plex-query/
COPY packages/auth-plugin-plex/package.json ./packages/auth-plugin-plex/

RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

COPY . .

# next.config.js imports env.js; skip validation during image build.
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

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

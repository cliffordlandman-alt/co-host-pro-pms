# LaunchRiot for Holiday Homes (YallaPMS) - production image. Two targets:
#   app : the Node API (port 3002), talks to Postgres via DATABASE_URL
#   web : Caddy serving the built web app + HTTPS, forwarding /api to app
# Works on x86 and Arm (Oracle Ampere). Build from the repository root:  docker compose -f deploy/cloud/docker-compose.yml build
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.28.2 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN cd artifacts/api-server && pnpm run build
RUN cd artifacts/yallastay && NODE_ENV=production BASE_PATH=/ node node_modules/vite/bin/vite.js build --config vite.config.ts

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production PORT=3002 HOST=0.0.0.0 MIGRATIONS_DIR=/app/drizzle
COPY --from=build /src /app
RUN rm -rf /app/artifacts/yallastay/dist /app/.local-data && useradd -r -u 10001 launchriot && chown -R launchriot /app
USER launchriot
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3002/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

FROM caddy:2 AS web
COPY --from=build /src/artifacts/yallastay/dist/public /srv
COPY deploy/cloud/Caddyfile /etc/caddy/Caddyfile

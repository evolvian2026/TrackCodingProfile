# Single-container build: the API serves the built SPA from its own process, so
# the whole app is one origin on one host.
#
# This exists because of the refresh cookie. It is SameSite=Strict, which is the
# right setting — but it means an SPA served from a different site than the API
# never sends it, so every session would end when the access token expires.
# Hosting both together removes the problem rather than weakening the cookie.
#
# It is also what free hosting tiers are shaped for: one web service, one
# managed Postgres, no Redis.
#
#   docker build -t tracker .
#   docker run -p 4000:4000 -e DATABASE_URL=... -e JWT_SECRET=... tracker
#
# Use docker-compose.yml instead for the full split stack with Redis and a
# separate worker.

# ---- build the SPA ---------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=frontend --include-workspace-root

COPY frontend ./frontend
# Empty, so the SPA calls the API on whatever origin it was served from.
ENV VITE_API_URL=""
RUN npm run build --workspace=frontend

# ---- build the API ---------------------------------------------------------
FROM node:22-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=backend --include-workspace-root

COPY backend ./backend
RUN npm run db:generate --workspace=backend \
 && npm run build --workspace=backend

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini curl \
 && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# The Prisma CLI is a runtime dependency because the container migrates itself.
RUN npm ci --omit=dev --workspace=backend --include-workspace-root \
 && npm cache clean --force

COPY --from=api /app/backend/dist ./backend/dist
COPY --from=api /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=api /app/node_modules/@prisma ./node_modules/@prisma
COPY backend/prisma ./backend/prisma
COPY --from=web /app/frontend/dist ./frontend/dist

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/backend/uploads && chown -R app:app /app

USER app
WORKDIR /app/backend

# One process does everything: API, SPA and the background queue.
ENV SERVE_WEB=true \
    WEB_DIST_DIR=../frontend/dist \
    QUEUE_DRIVER=inline \
    RUN_WORKER_IN_API=true \
    PORT=4000

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/src/index.js"]

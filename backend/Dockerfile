# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install with the workspace lockfile so versions are reproducible.
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
RUN npm ci --omit=dev --workspace=backend --include-workspace-root \
 && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY backend/prisma ./backend/prisma

RUN mkdir -p /app/backend/uploads && chown -R app:app /app
USER app
WORKDIR /app/backend

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

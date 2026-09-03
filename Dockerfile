# Enova Ops — one image, no external database.
#
# Two stages: the first installs everything and builds the React app; the second
# carries only production dependencies, the server, and the built assets. The
# data directory is a mounted volume, never baked into the image, so the same
# image runs anywhere and the data outlives it.

# ---- build stage -----------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install with the lockfile first so the dep layer caches across code changes.
COPY package*.json ./
RUN npm ci

# Build the client bundle. We run Vite only (not the type-check) here: type
# safety is enforced by `npm run typecheck` and the test suite, and skipping it
# roughly halves the build's memory and time so it completes on a small server.
# Cap the Node heap so the bundler stays within a 1 GB box's headroom.
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build:app

# ---- runtime stage ---------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data
WORKDIR /app

# Production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server, the shared vocabulary, the reference data, and the built client.
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

# The file-system database lives here, on a mounted volume owned by the app user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4000

# The server exposes /api/health; a failing container is one that stops answering it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

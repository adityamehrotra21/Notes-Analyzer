# NotesAnalyser API (Express) — built from the repo root: `docker build -t notesanalyser-api .`
# Used by Render (render.yaml) and by `docker compose --profile app up` locally.
# The React client is NOT in this image: it is hosted on Vercel. For a single-container local run,
# mount client/dist at /app/client/dist and set SERVE_CLIENT=true (see docker-compose.yml).
FROM node:22-bookworm-slim

# Chromium for Puppeteer PDF exports (system package instead of Puppeteer's download), fonts for the PDFs,
# dumb-init so signals reach node (graceful shutdown closes Chromium and flushes logs).
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=10000 \
    STORAGE_DIR=/app/server/storage

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
RUN mkdir -p storage && chown -R node:node /app
USER node

EXPOSE 10000
# Apply pending migrations (idempotent), then start. A failed migration stops the deploy.
CMD ["dumb-init", "sh", "-c", "node scripts/migrate.js && exec node src/index.js"]

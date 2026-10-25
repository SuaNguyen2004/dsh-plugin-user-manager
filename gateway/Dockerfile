FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm rebuild sqlite3 --build-from-source

COPY database/ ./database/
COPY gateway/ ./gateway/

RUN mkdir -p /data/gateway /data/temp \
    && chown -R node:node /app /data

ENV NODE_ENV=production \
    PORT=12345 \
    INTERNAL_PORT=3091 \
    DOCKER_CONTAINER=true \
    SQLITE_PATH=/data/gateway/users.db \
    DSH_MAIN_URL=http://dsh-main:3090 \
    TEMP=/data/temp \
    TMP=/data/temp

EXPOSE 12345

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:12345/health || exit 1

CMD ["node", "gateway/index.js"]

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
COPY master-backend/ ./master-backend/

RUN mkdir -p /app/data

ENV NODE_ENV=production \
    PORT=12345 \
    DOCKER_CONTAINER=true \
    SQLITE_PATH=/app/data/users.db

EXPOSE 12345

CMD ["node", "master-backend/index.js"]


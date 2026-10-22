FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY database/ ./database/
COPY master-backend/ ./master-backend/

RUN mkdir -p /app/data

ENV NODE_ENV=production \
    MASTER_PORT=4000 \
    POSTGRES_HOST=postgres \
    POSTGRES_PORT=5432 \
    POSTGRES_USER=dsh_admin \
    POSTGRES_PASSWORD=dsh_secure_password_2026 \
    POSTGRES_DB=dsh_enterprise_db

EXPOSE 4000

CMD ["node", "master-backend/index.js"]


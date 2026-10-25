FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

LABEL maintainer="dsh-enterprise"
LABEL description="DeepSeek Harness Shared Multi-Tenant Core (dsh-main)"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @deepseek-ai/dsh@0.2.0-rc.2 dshmarket@1.66.45

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY lib/ ./lib/
COPY router.js ./
COPY cordis.patch.yml ./
COPY patch-chmod.cjs ./
COPY patch-dsh-host.cjs ./
COPY inject-ui.cjs ./

RUN node /app/patch-dsh-host.cjs
RUN chmod 666 /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html || true

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

RUN npm link --no-audit --no-fund

RUN chown -R root:root /app && chmod -R 755 /app

RUN mkdir -p /data/dsh_homes /data/dsh_home /data/temp \
    && chown -R node:node /data \
    && chmod -R 775 /data

ENV NODE_ENV=production \
    NODE_PATH=/usr/local/lib/node_modules:/app/node_modules \
    NODE_OPTIONS="--require /app/patch-chmod.cjs" \
    ENABLE_DOCKER_CHMOD_WORKAROUND=true \
    DSH_HOMES_ROOT=/data/dsh_homes \
    GATEWAY_INTERNAL_URL=http://dsh-gateway:3091 \
    TEMP=/data/temp \
    TMP=/data/temp \
    PORT=3090

EXPOSE 3090

USER node

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:3090/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["node", "/app/router.js"]

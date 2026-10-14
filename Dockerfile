# Base image: Official Node 22 LTS (Bookworm slim) pinned by digest
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# Labels
LABEL maintainer="dsh-plugin-user-manager"
LABEL description="DeepSeek Harness Document-Only with Multi-user Manager"

# Install system dependencies if required for native tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install fixed version of DeepSeek Harness CLI globally
RUN npm install -g @deepseek-ai/dsh@0.2.0-rc.2

# Set up working directory for the plugin
WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json package-lock.json ./

# Install plugin production dependencies using lockfile
RUN npm ci --omit=dev

# Copy application source code, assets and verification helpers
COPY lib/ ./lib/
COPY public/ ./public/
COPY test/ ./test/
COPY cordis.patch.yml ./
COPY README.md ./
COPY patch-chmod.cjs ./

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

# Globally link plugin so Cordis runtime resolves 'dsh-plugin-user-manager'
RUN npm link

# Set ownership of code to root with read-only permissions for non-root users
RUN chown -R root:root /app && chmod -R 755 /app

# Create default multi-user data directories and assign ownership to 'node' user
RUN mkdir -p /data/dsh_home /data/db /data/workspaces /data/temp \
    && chown -R node:node /data \
    && chmod -R 775 /data

# Default environment variables for multi-user configuration
ENV NODE_ENV=production \
    NODE_PATH=/usr/local/lib/node_modules:/app/node_modules \
    NODE_OPTIONS="--require /app/patch-chmod.cjs" \
    ENABLE_DOCKER_CHMOD_WORKAROUND=true \
    DSH_HOME=/data/dsh_home \
    USERS_DB_PATH=/data/db/users.db \
    DSH_KEY_POOLS_FILE=/data/db/key_pools.json \
    USERS_WORKSPACES_ROOT=/data/workspaces \
    TEMP=/data/temp \
    TMP=/data/temp \
    PORT=3090

# Expose default testing port (3090)
EXPOSE 3090

# Switch to non-root user
USER node

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:${PORT}/login.html || exit 1

# Entrypoint initializes profile link then executes command
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command: launch DSH web profile on port 3090
CMD ["dsh", "web", "--port", "3090", "--no-open"]

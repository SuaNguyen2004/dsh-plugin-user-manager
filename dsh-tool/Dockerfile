FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

LABEL maintainer="dsh-enterprise"
LABEL description="DeepSeek Harness On-Demand Tool Sandbox (dsh-tool)"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-docx \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh-tool

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY runner.js manifest.user.json manifest.admin.json ./
COPY tools/ ./tools/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh \
    && mkdir -p /data /run/dsh-tool \
    && chown -R node:node /opt/dsh-tool /data /run/dsh-tool
# NOTE: Each user volume is mounted directly at /data/<username> (so the path inside
# the container is /data/<username>/<workspace>/files/<category>/<file>).
# /data/all_users_ro is only created/mounted when DSH_ROLE=admin.

ENV NODE_ENV=production \
    DSH_ROLE=user \
    WORKSPACE_ROOT=/data \
    ALL_USERS_RO_ROOT=/data/all_users_ro \
    TEMP=/tmp \
    TMP=/tmp

USER node

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

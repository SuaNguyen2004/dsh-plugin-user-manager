#!/bin/sh
set -e

# Default multi-user paths
DSH_HOME="${DSH_HOME:-/data/dsh_home}"
PROFILE_WEB_DIR="${DSH_HOME}/profiles/web"

# Ensure profile web directory and node_modules exist with strict error check
if ! mkdir -p "${PROFILE_WEB_DIR}/node_modules"; then
    echo "[docker-entrypoint] ERROR: Failed to create directory ${PROFILE_WEB_DIR}/node_modules. Profile directory is not writable." >&2
    exit 1
fi

# Ensure plugin link is valid
if [ ! -e "${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager" ]; then
    if ! ln -sfn /app "${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager"; then
        echo "[docker-entrypoint] ERROR: Failed to create symlink for dsh-plugin-user-manager in ${PROFILE_WEB_DIR}/node_modules." >&2
        exit 1
    fi
fi

# Only create package.json if it doesn't exist; do NOT overwrite existing config
if [ ! -f "${PROFILE_WEB_DIR}/package.json" ]; then
    if ! cat << 'EOF' > "${PROFILE_WEB_DIR}/package.json"
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-plugin-user-manager": "link:/app"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-user-manager"
      ]
    }
  }
}
EOF
    then
        echo "[docker-entrypoint] ERROR: Failed to write ${PROFILE_WEB_DIR}/package.json." >&2
        exit 1
    fi
fi

# Only create cordis.patch.yml if it doesn't exist; do NOT overwrite existing config
if [ ! -f "${PROFILE_WEB_DIR}/cordis.patch.yml" ]; then
    if ! cat << 'EOF' > "${PROFILE_WEB_DIR}/cordis.patch.yml"
- id: webserver
  config:
    host: 0.0.0.0
    port: !!js ctx.webStartup.port ?? 3090
- id: user-manager
  name: "dsh-plugin-user-manager"
  disabled: false
EOF
    then
        echo "[docker-entrypoint] ERROR: Failed to write ${PROFILE_WEB_DIR}/cordis.patch.yml." >&2
        exit 1
    fi
fi

# Verification step: ensure required configuration and plugin link are valid before executing DSH
if [ ! -e "${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager" ]; then
    echo "[docker-entrypoint] ERROR: Plugin symlink ${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager is invalid or missing." >&2
    exit 1
fi

if [ ! -s "${PROFILE_WEB_DIR}/package.json" ]; then
    echo "[docker-entrypoint] ERROR: ${PROFILE_WEB_DIR}/package.json is missing or empty." >&2
    exit 1
fi

if [ ! -s "${PROFILE_WEB_DIR}/cordis.patch.yml" ]; then
    echo "[docker-entrypoint] ERROR: ${PROFILE_WEB_DIR}/cordis.patch.yml is missing or empty." >&2
    exit 1
fi

# Execute passed command
exec "$@"

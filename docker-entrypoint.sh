#!/bin/sh
set -e

# Default multi-user paths
DSH_HOME="${DSH_HOME:-/data/dsh_home}"
PROFILE_WEB_DIR="${DSH_HOME}/profiles/web"

# Prepare web profile with user-manager plugin if not present
if [ ! -d "${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager" ]; then
    mkdir -p "${PROFILE_WEB_DIR}/node_modules" 2>/dev/null || true
    ln -sfn /app "${PROFILE_WEB_DIR}/node_modules/dsh-plugin-user-manager" 2>/dev/null || true
fi

if [ ! -f "${PROFILE_WEB_DIR}/package.json" ]; then
    cat << 'EOF' > "${PROFILE_WEB_DIR}/package.json" 2>/dev/null || true
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
fi

if [ ! -f "${PROFILE_WEB_DIR}/cordis.patch.yml" ]; then
    cat << 'EOF' > "${PROFILE_WEB_DIR}/cordis.patch.yml" 2>/dev/null || true
- id: webserver
  config:
    host: 0.0.0.0
    port: !!js ctx.webStartup.port ?? 3090
- id: user-manager
  name: "dsh-plugin-user-manager"
  disabled: false
EOF
fi

# Execute passed command
exec "$@"


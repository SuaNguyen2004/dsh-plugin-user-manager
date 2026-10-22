#!/bin/sh
set -e

DSH_HOME="${DSH_HOME:-/data/dsh_home}"
PROFILE_WEB_DIR="${DSH_HOME}/profiles/web"

mkdir -p "${PROFILE_WEB_DIR}/node_modules"
mkdir -p /data/workspace

# Link lightweight plugins into DSH web profile
if [ ! -e "${PROFILE_WEB_DIR}/node_modules/dsh-user-container-plugin" ]; then
    ln -sfn /app "${PROFILE_WEB_DIR}/node_modules/dsh-user-container-plugin"
fi

if [ ! -e "${PROFILE_WEB_DIR}/node_modules/dshmarket" ]; then
    ln -sfn /usr/local/lib/node_modules/dshmarket "${PROFILE_WEB_DIR}/node_modules/dshmarket"
fi

# Configure package.json with dshmarket bundle if not already present
if [ ! -f "${PROFILE_WEB_DIR}/package.json" ]; then
    cat << 'EOF' > "${PROFILE_WEB_DIR}/package.json"
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dshmarket": "1.66.45",
    "dsh-user-container-plugin": "link:/app"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "dsh-user-container-plugin"
      ]
    }
  }
}
EOF
fi

# Ensure cordis.patch.yml exists (do NOT overwrite if already configured with models)
if [ ! -f "${PROFILE_WEB_DIR}/cordis.patch.yml" ]; then
    cat << 'EOF' > "${PROFILE_WEB_DIR}/cordis.patch.yml"
- id: webserver
  config:
    host: 0.0.0.0
    port: !!js ctx.webStartup.port ?? 3090
- id: user-container-plugin
  name: "dsh-user-container-plugin"
  disabled: false
- id: dsh-market
  name: "dshmarket"
  disabled: false
EOF
fi

# Enable sidebar entry for dsh-market by default
mkdir -p "${PROFILE_WEB_DIR}/.dsh-market"
if [ ! -f "${PROFILE_WEB_DIR}/.dsh-market/state.json" ]; then
    cat << 'EOF' > "${PROFILE_WEB_DIR}/.dsh-market/state.json"
{
  "disabled": [],
  "groups": {},
  "groupOrder": [],
  "region": "global",
  "regionAuto": true,
  "sidebarEntry": true
}
EOF
fi

# Setup Read-only symlinks to other users' workspaces for Admin
if [ -d "/data/all_users_ro" ]; then
    echo "[docker-entrypoint] Configuring Read-Only symlinks for admin in /data/workspace..."
    mkdir -p /data/workspace
    CURRENT_ADMIN_ID="${DSH_USER_ID:-1}"
    CURRENT_ADMIN_NAME="${DSH_USER_NAME:-admin}"

    for user_dir in /data/all_users_ro/*; do
        if [ -d "$user_dir" ]; then
            dirname=$(basename "$user_dir")
            
            # Skip admin's own workspace folder (any folder containing admin)
            if [ "$dirname" = "${CURRENT_ADMIN_ID}_${CURRENT_ADMIN_NAME}" ] || echo "$dirname" | grep -qi "admin"; then
                continue
            fi
            
            friendly_name=$(echo "$dirname" | sed -E 's/^[0-9]+_//')
            target_link="/data/workspace/[View] ${friendly_name}"
            
            # If friendly name already symlinked, fallback to full directory name
            if [ -L "$target_link" ] && [ "$(readlink "$target_link")" != "$user_dir" ]; then
                target_link="/data/workspace/[View] ${dirname}"
            fi
            
            rm -f "$target_link" 2>/dev/null || true
            ln -s "$user_dir" "$target_link"
            echo "[docker-entrypoint] Created RO symlink: $target_link -> $user_dir"
        fi
    done
fi

# Inject Enterprise User Profile, Logout Modal and Settings Guards into Web UI
node /app/inject-ui.cjs || true

exec "$@"


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

    # Clean up old [View] legacy symlinks to avoid duplicate clutter
    find /data/workspace -maxdepth 1 -type l -name "\[View\] *" -exec rm -f {} + 2>/dev/null || true

    FOUND_ANY=0

    # 1. Quét sâu (recursive) toàn bộ thư mục /data/all_users_ro tìm tất cả file workspace.json
    find /data/all_users_ro -type f -name "workspace.json" 2>/dev/null > /tmp/ws_list.txt || true
    if [ -s /tmp/ws_list.txt ]; then
        while IFS= read -r ws_file || [ -n "$ws_file" ]; do
            if [ -n "$ws_file" ]; then
                ws_dir=$(dirname "$ws_file")
                
                # Bỏ qua nếu nằm trong thư mục của chính Admin
                if echo "$ws_dir" | grep -qi "admin"; then
                    continue
                fi
                
                ws_name=$(basename "$ws_dir")
                rel_path="${ws_dir#/data/all_users_ro/}"
                user_part=$(echo "$rel_path" | cut -d'/' -f1)
                user_name=$(echo "$user_part" | sed -E 's/^[0-9]+_//')
                
                if [ -n "$ws_name" ] && [ -n "$user_name" ]; then
                    target_link="/data/workspace/${ws_name} (${user_name})"
                    rm -f "$target_link" 2>/dev/null || true
                    ln -s "$ws_dir" "$target_link"
                    echo "[docker-entrypoint] Created RO symlink from workspace.json: $target_link -> $ws_dir"
                    FOUND_ANY=1
                fi
            fi
        done < /tmp/ws_list.txt
        rm -f /tmp/ws_list.txt
    fi

    # 2. Quét dự phòng (Fallback): Nếu chưa có file workspace.json thì quét các thư mục con hoặc thư mục gốc
    if [ "$FOUND_ANY" -eq 0 ]; then
        for user_dir in /data/all_users_ro/*; do
            if [ -d "$user_dir" ]; then
                dirname=$(basename "$user_dir")
                if [ "$dirname" = "${CURRENT_ADMIN_ID}_${CURRENT_ADMIN_NAME}" ] || echo "$dirname" | grep -qi "admin"; then
                    continue
                fi
                user_name=$(echo "$dirname" | sed -E 's/^[0-9]+_//')

                sub_found=0
                for sub_dir in "$user_dir"/*; do
                    if [ -d "$sub_dir" ]; then
                        sub_name=$(basename "$sub_dir")
                        case "$sub_name" in
                            .*) continue ;;
                        esac
                        target_link="/data/workspace/${sub_name} (${user_name})"
                        rm -f "$target_link" 2>/dev/null || true
                        ln -s "$sub_dir" "$target_link"
                        echo "[docker-entrypoint] Created RO symlink (subfolder): $target_link -> $sub_dir"
                        sub_found=1
                    fi
                done

                if [ "$sub_found" -eq 0 ]; then
                    target_link="/data/workspace/Workspace (${user_name})"
                    rm -f "$target_link" 2>/dev/null || true
                    ln -s "$user_dir" "$target_link"
                    echo "[docker-entrypoint] Created RO symlink (root): $target_link -> $user_dir"
                fi
            fi
        done
    fi
fi

# Inject Enterprise User Profile, Logout Modal and Settings Guards into Web UI
node /app/inject-ui.cjs || true

exec "$@"


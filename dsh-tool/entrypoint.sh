#!/bin/sh
set -e

ROLE="${DSH_ROLE:-user}"
USERNAME="${DSH_USERNAME:-user}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/data}"

if [ "$ROLE" != "user" ] && [ "$ROLE" != "admin" ]; then
    echo "[dsh-tool] ERROR: Invalid DSH_ROLE '$ROLE'. Allowed: user | admin" >&2
    exit 1
fi

MANIFEST_FILE="/opt/dsh-tool/manifest.${ROLE}.json"
if [ ! -f "$MANIFEST_FILE" ]; then
    echo "[dsh-tool] ERROR: Manifest not found: $MANIFEST_FILE" >&2
    exit 1
fi

# Prepare the primary directory layout for this user:
#   /data/<username>/default-workspace/files/{docs,pdf,sheets,images,others}
SAFE_USER=$(printf '%s' "$USERNAME" | tr -c '[:alnum:]._-' '_')
mkdir -p "${WORKSPACE_ROOT}/${SAFE_USER}/default-workspace/files/docs" \
         "${WORKSPACE_ROOT}/${SAFE_USER}/default-workspace/files/pdf" \
         "${WORKSPACE_ROOT}/${SAFE_USER}/default-workspace/files/sheets" \
         "${WORKSPACE_ROOT}/${SAFE_USER}/default-workspace/files/images" \
         "${WORKSPACE_ROOT}/${SAFE_USER}/default-workspace/files/others" \
         /run/dsh-tool 2>/dev/null || true

if [ "$ROLE" = "admin" ]; then
    mkdir -p /data/all_users_ro 2>/dev/null || true
else
    rmdir /data/all_users_ro 2>/dev/null || true
fi

cp "$MANIFEST_FILE" /run/dsh-tool/active-manifest.json
echo "$ROLE" > /run/dsh-tool/active-role
echo "ready" > /run/dsh-tool/ready

echo "[dsh-tool] Ready role=${ROLE} user=${SAFE_USER} root=${WORKSPACE_ROOT}/${SAFE_USER} manifest=${MANIFEST_FILE}"

if [ $# -gt 0 ]; then
    exec "$@"
fi
exec sleep infinity

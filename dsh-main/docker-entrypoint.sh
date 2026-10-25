#!/bin/sh
set -e

# dsh-main entrypoint (Phase 4 — Shared Brain, approach B: one DSH child process per tenant).
# The router (router.js) is the only long-lived process: it owns :3090, authenticates
# gateway-injected X-DSH-* headers lazily spawns one DSH child per tenant with a private
# DSH_HOME under $DSH_HOMES_ROOT, and reverse-proxies HTTP+WS to it.
#
# Legacy model's admin RO symlinks / workspace scaffolding are intentionally GONE:
#  - dsh-main never mounts a workspace volume (security #11: every file operation is
#    routed to dsh-tool-<username> through POST /internal/exec),
#  - Admin's read-only monitoring views are registered from the dsh-homes volume by
#    lib/user/workspace.js, not by entrypoint symlinks into /data/all_users_ro,
#  - the enterprise UI is injected per tenant by lib/index.js via webServer.tapIndex.

HOMES_ROOT="${DSH_HOMES_ROOT:-/data/dsh_homes}"
mkdir -p "${HOMES_ROOT}" /data/temp
chown -R node:node /data || true

echo "[dsh-main] Shared Brain router starting; homes root=${HOMES_ROOT} port=${PORT:-3090}"
exec "$@"

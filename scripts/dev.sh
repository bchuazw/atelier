#!/usr/bin/env bash
# Atelier local dev — starts all three services in parallel.
# Ctrl-C kills everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

trap 'echo; echo "[dev] stopping..."; kill 0 2>/dev/null || true' INT TERM EXIT

echo "[dev] sandbox-server  :${ATELIER_SANDBOX_PORT:-4100}"
( cd sandbox-server && ATELIER_ASSETS_DIR="$ROOT/assets" ATELIER_SANDBOX_PORT="${ATELIER_SANDBOX_PORT:-4100}" node server.js ) &

echo "[dev] api             :${ATELIER_API_PORT:-8000}"
( cd apps/api && python -m uvicorn atelier_api.main:app --reload --port "${ATELIER_API_PORT:-8000}" ) &

echo "[dev] web             :${ATELIER_WEB_PORT:-3000}"
( cd apps/web && npx vite --port "${ATELIER_WEB_PORT:-3000}" --host ) &

wait

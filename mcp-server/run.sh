#!/usr/bin/env bash
# Run the Atelier MCP server on stdio.
#
# Useful for manual testing before wiring into Claude Code's mcp config:
#
#   ./mcp-server/run.sh
#   # then paste a JSON-RPC request like:
#   {"jsonrpc":"2.0","id":1,"method":"tools/list"}
#
# Override the backend by exporting ATELIER_API_BASE before invoking, e.g.:
#
#   ATELIER_API_BASE=http://localhost:8000/api/v1 ./mcp-server/run.sh

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
exec python -m mcp_server "$@"

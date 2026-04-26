#!/usr/bin/env bash
# Atelier dev-clean — kills stale workers, purges __pycache__, then exec's dev.sh.
# Designed for Git Bash on Windows. Best-effort hygiene — never aborts.
#
# Why this exists: uvicorn --reload on Windows spawns multiprocessing fork
# children that get orphaned when their parent dies (Ctrl-C, terminal close).
# Those orphans keep serving stale code on :8000, hiding correct fixes during
# verification rounds. Plus stale __pycache__ dirs occasionally persist.
#
# Run via:  npm run dev:clean

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Helpers --------------------------------------------------------------------
log()  { printf '[clean] %s\n'  "$*"; }
warn() { printf '[clean] WARN: %s\n' "$*" >&2; }

# Returns PIDs (one per line) for image $1 whose CommandLine matches regex $2.
# Uses wmic which is present on Git Bash for Windows. Tolerant of "No Instance(s) Available".
find_pids_by_cmdline() {
  local image="$1"
  local pattern="$2"
  # wmic CSV: Node,CommandLine,Name,ProcessId
  wmic process where "name='$image'" get ProcessId,CommandLine /format:csv 2>/dev/null \
    | tr -d '\r' \
    | awk -F',' -v pat="$pattern" '
        NR>1 && NF>=4 {
          # Reassemble CommandLine which may contain commas — everything between
          # field 2 and the last field (ProcessId) is the command line.
          cmd=""
          for (i=2; i<NF-1; i++) cmd = cmd (i==2?"":",") $i
          # Last field before ProcessId is Name; ProcessId is final field
          pid=$NF
          if (cmd ~ pat && pid ~ /^[0-9]+$/) print pid
        }'
}

kill_pids() {
  local label="$1"; shift
  local pids="$*"
  local killed=0
  if [ -z "$pids" ]; then
    log "kill $label... ok (0 killed)"
    return 0
  fi
  for pid in $pids; do
    if taskkill //F //PID "$pid" >/dev/null 2>&1; then
      killed=$((killed+1))
    else
      warn "could not kill pid $pid ($label)"
    fi
  done
  log "kill $label... ok ($killed killed)"
}

# 1+2+3. Process kills --------------------------------------------------------
# 1. uvicorn workers (parent + multiprocessing-fork children + bare atelier_api imports)
PY_PIDS="$(find_pids_by_cmdline 'python.exe'  'uvicorn|multiprocessing-fork|atelier_api' || true)"
kill_pids "uvicorn workers" $PY_PIDS

# 2. sandbox-server node process
SBX_PIDS="$(find_pids_by_cmdline 'node.exe' 'sandbox-server[\\\\/]+server\\.js' || true)"
kill_pids "sandbox-server" $SBX_PIDS

# 3. vite web (port 3000/3001). Match on either "vite" + apps/web cwd, or fall back
# to the listener-on-port check below to avoid killing unrelated vite instances.
VITE_PIDS="$(find_pids_by_cmdline 'node.exe' 'vite' || true)"
# Filter to vite invocations that look like ours: include only those whose cmdline
# also references apps/web, atelier, or ports 3000/3001.
VITE_FILTERED=""
for pid in $VITE_PIDS; do
  cmd="$(wmic process where "ProcessId=$pid" get CommandLine /format:list 2>/dev/null | tr -d '\r' | grep -i '^CommandLine=' || true)"
  if echo "$cmd" | grep -E -i 'apps[\\/]+web|atelier|--port[ =]+(3000|3001)' >/dev/null; then
    VITE_FILTERED="$VITE_FILTERED $pid"
  fi
done

# Also catch anything currently LISTENING on 3000/3001 — that's by definition our web dev server.
for port in 3000 3001; do
  for pid in $(netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$port" '$0 ~ /LISTENING/ && $2 ~ p"$" { print $5 }' | sort -u); do
    [ -n "$pid" ] && [ "$pid" != "0" ] && VITE_FILTERED="$VITE_FILTERED $pid"
  done
done
# de-dupe
VITE_FILTERED="$(echo $VITE_FILTERED | tr ' ' '\n' | sort -u | tr '\n' ' ')"
kill_pids "vite web (:3000/:3001)" $VITE_FILTERED

# 4. Purge __pycache__ under apps/api/atelier_api ----------------------------
PYCACHE_TARGET="$ROOT/apps/api/atelier_api"
if [ -d "$PYCACHE_TARGET" ]; then
  PYC_COUNT="$(find "$PYCACHE_TARGET" -name __pycache__ -type d 2>/dev/null | wc -l | tr -d ' ')"
  find "$PYCACHE_TARGET" -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
  log "removing __pycache__... ok (${PYC_COUNT:-0} dirs)"
else
  warn "skip __pycache__ purge: $PYCACHE_TARGET not found"
fi

# 5. Wait for ports to release -----------------------------------------------
log "waiting 3s for ports to release..."
sleep 3

# 6. Verify ports 3000, 4100, 8000 are free ----------------------------------
# Portable Git Bash check — netstat -ano lists all sockets; we filter LISTENING + :PORT.
port_in_use() {
  local port="$1"
  netstat -ano 2>/dev/null \
    | tr -d '\r' \
    | awk -v p=":$port" '$0 ~ /LISTENING/ && $2 ~ p"$" { found=1 } END { exit found?0:1 }'
}

ALL_FREE=1
for port in 3000 4100 8000; do
  if port_in_use "$port"; then
    warn "port $port still in use"
    ALL_FREE=0
  fi
done
if [ "$ALL_FREE" = "1" ]; then
  log "ports free... ok"
else
  log "ports free... partial (see warnings; continuing anyway)"
fi

# 7. Hand off to dev.sh ------------------------------------------------------
log "starting fresh dev stack..."
exec bash "$ROOT/scripts/dev.sh"

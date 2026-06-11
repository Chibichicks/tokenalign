#!/bin/bash
#
# Cron Wrapper: SG Tax Job Search → Dashboard → GBrain Sync
#
# Runs on schedule via crontab. Handles:
#   1. File locking to prevent overlapping runs
#   2. MCF-only extraction (fast REST API, runs every scheduled time)
#   3. Full pipeline (MCF + LinkedIn) at specific times (8:30 AM, 1:30 PM)
#   4. GBrain sync after dashboard update (only when new jobs found)
#
# Exit codes:
#   0 - Success or skipped (lock held)
#   1 - Extraction failed
#   2 - GBrain sync failed (non-fatal — dashboard still updated)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCKFILE="/tmp/job_search_cron.lock"
EXTRACT_SCRIPT="$SCRIPT_DIR/sg-tax-job-extract.js"
LOGDIR="$HOME/.hermes/logs"
LOGFILE="$LOGDIR/job_search_cron.log"
GBRAIN="/home/lucas/.bun/bin/gbrain"
DASHBOARD_DIR="/home/lucas/documents/job_search"
HOUR=$(date +%H)
MINUTE=$(date +%M)
HOUR_NUM=$((10#$HOUR))

# ─── Explicit PATH (no bashrc sourcing — prevents hangs from interactive commands) ──
# Script uses /usr/bin/node explicitly; bun/gbrain paths added for gbrain sync.
export PATH="/usr/bin:/bin:/usr/local/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export HOME="${HOME:-/home/lucas}"

# ─── Ensure log directory exists ─────────────────────────────────────
mkdir -p "$LOGDIR"

# ─── Defaults: MCF-only for most runs ────────────────────────────────
MODE="mcf-only"
MAX_PAGES=2

# ─── File locking (flock) to prevent overlapping runs ────────────────
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "[$(date -Iseconds)] SKIP: Previous run still in progress (lock held)" >> "$LOGFILE"
    exit 0
fi

log() {
    echo "[$(date -Iseconds)] $*" >> "$LOGFILE"
}

log "START (hour=$HOUR, minute=$MINUTE)"

# ─── Determine run mode ──────────────────────────────────────────────
# Most runs: MCF-only (fast REST API, <30 seconds)
# 8:30 AM and 1:30 PM: Full pipeline (MCF + LinkedIn, ~3-5 minutes)
if [[ "$HOUR_NUM" == "8" && "$MINUTE" == "30" ]] || \
   [[ "$HOUR_NUM" == "13" && "$MINUTE" == "30" ]]; then
    MODE="full"
    MAX_PAGES=3
fi

log "MODE=$MODE, MAX_PAGES=$MAX_PAGES"

# ─── Run extraction ──────────────────────────────────────────────────
EXTRACT_FLAGS="--max-pages $MAX_PAGES --markdown --update-tracking --verbose"

if [[ "$MODE" == "mcf-only" ]]; then
    EXTRACT_FLAGS="$EXTRACT_FLAGS --mcf-only"
fi

log "Running: node $EXTRACT_SCRIPT $EXTRACT_FLAGS"

# Capture log line count NOW (before extraction writes to log)
LOG_LINES_BEFORE=$(wc -l < "$LOGFILE" 2>/dev/null || echo "0")

# Run extraction: stderr to log, stdout flows to cron (for Discord delivery)
EXTRACT_TMP=$(mktemp)
trap 'rm -f "$EXTRACT_TMP"' EXIT
if /usr/bin/node "$EXTRACT_SCRIPT" $EXTRACT_FLAGS 2>> "$LOGFILE" > "$EXTRACT_TMP"; then
    log "Extraction: SUCCESS"
    # Print the markdown report to stdout (Discord delivery)
    cat "$EXTRACT_TMP"
else
    EXIT_CODE=$?
    log "Extraction: FAILED (exit $EXIT_CODE)"
    cat "$EXTRACT_TMP"
    exit 1
fi

# ─── Sync dashboard into GBrain (only when new jobs were actually injected) ──
# Check stderr log for "[DASHBOARD] Injected N new jobs" — this uses the true
# deduped count from updateDashboard(), not the pre-dedup markdown count.

LOG_LINES_AFTER=$(wc -l < "$LOGFILE" 2>/dev/null || echo "0")
NEW_LOG_LINES=$((LOG_LINES_AFTER - LOG_LINES_BEFORE))

if [[ "$NEW_LOG_LINES" -gt 0 ]]; then
    INJECTED_LINE=$(tail -n "$NEW_LOG_LINES" "$LOGFILE" | grep '\[DASHBOARD\] Injected' | tail -1 || echo "")
else
    INJECTED_LINE=""
fi

if [[ -n "$INJECTED_LINE" ]]; then
    INJECTED_COUNT=$(echo "$INJECTED_LINE" | grep -o '[0-9]\+' | head -1)
    if [[ "${INJECTED_COUNT:-0}" -gt 0 ]]; then
        log "Dashboard updated ($INJECTED_COUNT new jobs injected) — syncing to GBrain"

        if [[ -x "$GBRAIN" ]]; then
            if OPENAI_API_KEY="${OPENAI_API_KEY:-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}" \
               "$GBRAIN" import "$DASHBOARD_DIR" 2>> "$LOGFILE"; then
                log "GBrain sync: SUCCESS"
            else
                log "GBrain sync: FAILED (non-fatal)"
            fi
        else
            log "GBrain sync: SKIPPED (gbrain not found at $GBRAIN)"
        fi
    else
        log "Dashboard unchanged (0 new jobs injected) — skipping GBrain sync"
    fi
else
    log "Dashboard unchanged (no injection log) — skipping GBrain sync"
fi

# ─── Rotate log (keep last 20000 lines, persistent path) ─────────────
if [[ -f "$LOGFILE" ]]; then
    LINE_COUNT=$(wc -l < "$LOGFILE")
    if [[ "$LINE_COUNT" -gt 20000 ]]; then
        tail -n 20000 "$LOGFILE" > "${LOGFILE}.tmp"
        mv "${LOGFILE}.tmp" "$LOGFILE"
    fi
fi

log "DONE"
exit 0

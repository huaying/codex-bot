#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${CODEX_BOT_LOG_DIR:-"$ROOT/.data/logs"}"
LOG_FILE="${CODEX_BOT_LOG_FILE:-"$LOG_DIR/bot.log"}"
RESTART_DELAY="${CODEX_BOT_RESTART_DELAY_SECONDS:-5}"
RUN_COMMAND="${CODEX_BOT_RUN_COMMAND:-npm run prod}"

cd "$ROOT" || exit 1
mkdir -p "$LOG_DIR"

while true; do
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting: $RUN_COMMAND" | tee -a "$LOG_FILE"
  bash -lc "$RUN_COMMAND" 2>&1 | tee -a "$LOG_FILE"
  status="${PIPESTATUS[0]}"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] bot exited with status $status; restarting in ${RESTART_DELAY}s" | tee -a "$LOG_FILE"
  sleep "$RESTART_DELAY"
done

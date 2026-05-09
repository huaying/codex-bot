#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${CODEX_BOT_TMUX_SESSION:-codex-bot}"
LOG_FILE="${CODEX_BOT_LOG_FILE:-"$ROOT/.data/logs/bot.log"}"

usage() {
  echo "Usage: $0 {start|stop|restart|status|logs|attach}"
}

has_session() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

case "${1:-}" in
  start)
    if has_session; then
      echo "tmux session '$SESSION' is already running"
      exit 0
    fi
    tmux new-session -d -s "$SESSION" "cd \"$ROOT\" && bash scripts/run-forever.sh"
    echo "started tmux session '$SESSION'"
    ;;
  stop)
    if has_session; then
      tmux kill-session -t "$SESSION"
      echo "stopped tmux session '$SESSION'"
    else
      echo "tmux session '$SESSION' is not running"
    fi
    ;;
  restart)
    if has_session; then
      tmux kill-session -t "$SESSION"
      echo "stopped tmux session '$SESSION'"
    fi
    tmux new-session -d -s "$SESSION" "cd \"$ROOT\" && bash scripts/run-forever.sh"
    echo "started tmux session '$SESSION'"
    ;;
  status)
    if has_session; then
      echo "tmux session '$SESSION' is running"
      tmux list-panes -t "$SESSION" -F "pane=#{pane_index} pid=#{pane_pid} command=#{pane_current_command}"
    else
      echo "tmux session '$SESSION' is not running"
      exit 1
    fi
    ;;
  logs)
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    tail -f "$LOG_FILE"
    ;;
  attach)
    exec tmux attach -t "$SESSION"
    ;;
  *)
    usage
    exit 2
    ;;
esac

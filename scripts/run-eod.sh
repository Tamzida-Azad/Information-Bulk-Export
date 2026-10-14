#!/usr/bin/env bash
# EOD Generator — shell runner (Git Bash / WSL / macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

export EOD_HEADED="${EOD_HEADED:-1}"

LOG="logs/scheduler.log"
echo "[$(date -Iseconds 2>/dev/null || date)] Starting EOD Generator ($*)" >> "$LOG"

if [[ ! -x "node_modules/.bin/tsx" && ! -f "node_modules/tsx/dist/cli.mjs" ]]; then
  echo "Missing dependencies. Run: npm install" | tee -a "$LOG"
  exit 1
fi

set +e
npx tsx src/eod.ts "$@" >> "$LOG" 2>&1
CODE=$?
set -e

if [[ $CODE -eq 0 ]]; then
  echo "[$(date -Iseconds 2>/dev/null || date)] SUCCESS" >> "$LOG"
else
  echo "[$(date -Iseconds 2>/dev/null || date)] FAILED exit $CODE" >> "$LOG"
fi
exit "$CODE"

#!/bin/bash
# Hourly job: scrape Yad2, commit + push updated listings so GitHub Pages refreshes.
set -euo pipefail

export PATH="/Users/solalohana/.nvm/versions/node/v22.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")"

LOG="run.log"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') =====" >> "$LOG"

# Run the scraper (non-fatal: on failure it keeps previous data).
if node scrape.js >> "$LOG" 2>&1; then
  echo "scrape ok" >> "$LOG"
else
  echo "scrape returned non-zero (kept previous data)" >> "$LOG"
fi

# Commit + push only if listings.json actually changed.
if ! git diff --quiet -- docs/listings.json; then
  git add docs/listings.json
  git commit -q -m "update listings $(date '+%Y-%m-%d %H:%M')" >> "$LOG" 2>&1
  git push -q >> "$LOG" 2>&1 && echo "pushed" >> "$LOG"
else
  echo "no changes to push" >> "$LOG"
fi

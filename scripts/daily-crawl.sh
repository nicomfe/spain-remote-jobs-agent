#!/bin/sh
# Droplet cron entry: live crawl of kept Directory boards, then commit public JSON.
# Dev does not run this. CRAWL_OPEN_ISSUE=1 opens a GitHub issue on failure.
set -eu
cd "$(dirname "$0")/.."
export CRAWL_GIT_COMMIT="${CRAWL_GIT_COMMIT:-1}"
export CRAWL_OPEN_ISSUE="${CRAWL_OPEN_ISSUE:-1}"
exec node scripts/daily-crawl.mjs --live

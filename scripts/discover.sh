#!/bin/sh
# Droplet cron entry: twice-monthly discovery of YC, Common Crawl, and Wellfound.
# Dev does not run this. CRAWL_OPEN_ISSUE=1 opens a GitHub issue on failure.
set -eu
cd "$(dirname "$0")/.."
export CRAWL_GIT_COMMIT="${CRAWL_GIT_COMMIT:-1}"
export CRAWL_OPEN_ISSUE="${CRAWL_OPEN_ISSUE:-1}"
exec node scripts/discover.mjs --live

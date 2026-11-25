#!/bin/sh
# Droplet-side pull. Run from a timer on the droplet, never from GitHub Actions.
# Pulls the newest image from GHCR and recreates only the services whose image changed.
set -eu

cd "$(dirname "$0")"
docker compose pull
docker compose up -d --remove-orphans

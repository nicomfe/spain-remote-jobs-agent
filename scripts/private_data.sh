#!/bin/bash
# Private bundle for contacts, crawl cursors, and headcount notes.
# jobs.json and directory.json stay plaintext in the product repo.
#
#   scripts/private_data.sh pull              # private repo -> SRJ_PRIVATE_DIR
#   scripts/private_data.sh push              # those files -> private repo, one commit
#   scripts/private_data.sh contacts OUT      # only contacts.json, to OUT
#
# The ciphertext checkout defaults to the sibling directory
# spain-remote-jobs-agent-data, next to this repo. Plaintext stays in
# SRJ_PRIVATE_DIR. On the droplet, set SRJ_PRIVATE_CLONE to the host path.
#
# Encrypted with AES-256-CBC (openssl, PBKDF2, 600000 iterations, SHA-256)
# under DATA_KEY: the env var on the droplet, the login Keychain on the Mac
# (service spain-remote-jobs-agent, account data-key). The GitHub repo stores
# ciphertext only.
#
# push refuses when the private repo moved since this machine's last pull.
set -Eeuo pipefail

REPO="${SRJ_PRIVATE_REPO:-git@github.com:nicomfe/spain-remote-jobs-agents-data.git}"
FILES=(contacts.json cursors.json headcount-notes.json)
BLOB=data.tar.gz.enc

root="${SRJ_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
dir="${SRJ_PRIVATE_DIR:-$HOME/.local/share/spain-remote-jobs-agent/private}"
clone="${SRJ_PRIVATE_CLONE:-$(dirname "$root")/spain-remote-jobs-agent-data}"
pulled="$clone/.git/pulled"

key() {
  if [ -n "${DATA_KEY:-}" ]; then return; fi
  DATA_KEY="$(security find-generic-password -s spain-remote-jobs-agent -a data-key -w 2>/dev/null)" \
    || { echo "No DATA_KEY and none in the Keychain (account data-key)." >&2; exit 1; }
  export DATA_KEY
}

crypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:DATA_KEY "$@"; }

sync_clone() {
  if [ -d "$clone/.git" ]; then
    git -C "$clone" fetch -q origin
  else
    mkdir -p "$(dirname "$clone")"
    git clone -q "$REPO" "$clone"
  fi
}

remote_head() { git -C "$clone" rev-parse -q --verify origin/main || true; }
data_head() { git -C "$clone" log -1 --format=%H origin/main -- "$BLOB" 2>/dev/null || true; }

checkout_main() {
  local head="$1"
  if [ -n "$head" ]; then
    git -C "$clone" checkout -q -B main "$head"
  elif git -C "$clone" rev-parse -q --verify HEAD >/dev/null; then
    git -C "$clone" checkout -q -B main
  else
    git -C "$clone" checkout -q --orphan main
  fi
}

pull() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  [ -n "$head" ] || { echo "The private repo is empty: push first." >&2; exit 1; }
  git -C "$clone" checkout -q -B main "$head"
  mkdir -p "$dir"
  local saved=()
  for f in "${FILES[@]}"; do [ -f "$dir/$f" ] && saved+=("$f"); done
  if [ ${#saved[@]} -gt 0 ]; then
    mkdir -p "$(dirname "$dir")/backups"
    tar -C "$dir" -czf "$(dirname "$dir")/backups/before-pull-$(date -u +%Y%m%dT%H%M%S).tar.gz" "${saved[@]}"
  fi
  local tarball
  tarball="$(mktemp)"
  if ! crypt -d -in "$clone/$BLOB" -out "$tarball"; then
    rm -f "$tarball"
    echo "Could not decrypt the private bundle." >&2
    exit 1
  fi
  tar -tzf "$tarball" > /dev/null
  tar -tzf "$tarball" | grep -qx "contacts.json" \
    || { rm -f "$tarball"; echo "The bundle has no contacts.json." >&2; exit 1; }
  tar -xzf "$tarball" -C "$dir"
  rm -f "$tarball"
  [ -s "$dir/contacts.json" ] \
    || { echo "The pulled contacts.json is empty: stopping." >&2; exit 1; }
  data_head > "$pulled"
  echo "Pulled $(git -C "$clone" log -1 --format='%h %s')"
}

push() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  if [ -n "$head" ] && [ "$(data_head)" != "$(cat "$pulled" 2>/dev/null || true)" ]; then
    echo "The private repo moved since the last pull here. Pull, redo the edit, push." >&2
    exit 1
  fi
  [ -s "$dir/contacts.json" ] || { echo "No $dir/contacts.json to push." >&2; exit 1; }
  local present=()
  for f in "${FILES[@]}"; do
    [ -f "$dir/$f" ] && present+=("$f")
  done
  checkout_main "$head"
  tar -C "$dir" -czf - "${present[@]}" | crypt -e -salt -out "$clone/$BLOB"
  git -C "$clone" add -- "$BLOB"
  git -C "$clone" -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo refresh)}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo refresh@localhost)}" \
    commit -q -m "Data $(date -u +%F)"
  git -C "$clone" push -q origin main
  git -C "$clone" rev-parse HEAD > "$pulled"
  echo "Pushed $(git -C "$clone" log -1 --format='%h %s')"
}

contacts() {
  key
  sync_clone
  local tmp
  tmp="$(mktemp)"
  if ! git -C "$clone" show "origin/main:$BLOB" | crypt -d | tar -xzOf - contacts.json > "$tmp"; then
    rm -f "$tmp"
    echo "Could not read contacts.json from the private bundle." >&2
    exit 1
  fi
  [ -s "$tmp" ] || { rm -f "$tmp"; echo "contacts.json in the bundle is empty." >&2; exit 1; }
  mv "$tmp" "$1"
}

case "${1:-}" in
  pull) pull ;;
  push) push ;;
  contacts) contacts "${2:?usage: $0 contacts OUT}" ;;
  *) echo "usage: $0 pull|push|contacts OUT" >&2; exit 2 ;;
esac

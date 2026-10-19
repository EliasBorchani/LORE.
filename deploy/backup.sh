#!/bin/sh
# Nightly backup: a full export (history, accounts, characters), the last 14 kept on the server, each copied off the
# machine when BACKUP_REMOTE is set in .env (an rsync target, for example u123@u123.your-storagebox.de:lore).
# Cron, as the deploying user: 30 3 * * * /srv/lore/deploy/backup.sh >> /srv/lore/exports/backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
. ./.env

name=$(date -u +%Y-%m-%dT%H%M%SZ)
# Run as this user: the export is private (0700, password hashes inside), so this user must own it to prune and copy.
docker compose -f compose.prod.yaml exec -T --user "$(id -u):$(id -g)" server server export "/exports/$name"
echo "$(date -u +%FT%TZ) exported $name"

# Keep the 14 newest exports (the folder names sort by date).
ls -1d exports/20*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --delete exports/ "$BACKUP_REMOTE/"
  echo "$(date -u +%FT%TZ) copied to $BACKUP_REMOTE"
fi

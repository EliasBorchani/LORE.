#!/bin/sh
# Imports every official batch into a production database that already has a catalog (the first import is
# deploy/import-content.sh). An import only writes a new version when an entity changed, so running it on every file
# is safe and unchanged files cost nothing.
# Danalieth's reference catalog is left out: it would put back her drafts of entities the SRD batches replaced.
# Before importing, it stops if an official entity was last edited in the app: the import would replace that edit
# (spell levels included, from lists.json). Check those first, then run again with --force.
# Usage: deploy/import-update.sh [--dry-run] [--force]
set -eu
cd "$(dirname "$0")/.."

DRY_RUN=
FORCE=
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

psql() {
  docker compose -f compose.prod.yaml exec -T postgres psql -U dnd -d dnd -At -c "$1"
}

entities=$(psql "SELECT count(*) FROM entity")
if [ "$entities" = "0" ]; then
  echo "The catalog is empty: use deploy/import-content.sh for the first import." >&2
  exit 1
fi

# Official entities whose current version comes from the app, not from an import (authors of imports: srd-import, import).
edited=$(psql "SELECT e.id || '  (' || v.author || ', ' || to_char(v.created_at, 'YYYY-MM-DD') || ')'
               FROM entity e JOIN entity_version v ON v.entity_id = e.id AND v.version = e.current_version
               WHERE e.ruleset_id IS NULL AND v.author NOT IN ('srd-import', 'import') ORDER BY e.id")
if [ -n "$edited" ] && [ -z "$FORCE" ]; then
  echo "Official entities edited in the app; an import of their batch would replace the edit:" >&2
  echo "$edited" >&2
  echo "Check them (history in the app), then run again with --force." >&2
  exit 1
fi

run() {
  echo "== $1"
  docker compose -f compose.prod.yaml exec -T server server import "/$1" --author srd-import \
    --note "${NOTE:-official content update}" ${DRY_RUN:+--dry-run}
}

for file in content/srd/rules.json content/srd/sources.json content/srd/situations.json content/srd/races.json content/srd/domains.json \
            content/srd/tob/*.json content/srd/arcane/*.json content/srd/classes/*.json content/srd/prestige/*.json content/srd/feats/*.json \
            content/srd/equipment/*.json content/srd/spells/*.json; do
  run "$file"
done

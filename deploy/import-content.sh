#!/bin/sh
# Imports the whole official catalog into a fresh production database, in an order that works:
# 1. Danalieth's reference catalog, which holds the core rule sections (statistics, bonus types, dice steps...)
#    and her entities; 2. the SRD batches, which replace the drafts she had of the same entities (Wizard, Sorcerer).
# Usage: deploy/import-content.sh [--dry-run]. For an empty database only: run again, step 1 would put back her drafts
# and step 2 replace them again, a useless version each time. Later batches are imported one by one (docs/deploy.md).
set -eu
cd "$(dirname "$0")/.."

entities=$(docker compose -f compose.prod.yaml exec -T postgres psql -U dnd -d dnd -At -c "SELECT count(*) FROM entity")
if [ "$entities" != "0" ]; then
  echo "The catalog already has $entities entities: this script is for the first import only." >&2
  exit 1
fi

run() {
  echo "== $1"
  docker compose -f compose.prod.yaml exec -T server server import "/$1" --author srd-import \
    --note "initial import" ${DRY_RUN:+--dry-run}
}
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

run test-references/danalieth/catalog.json
for file in content/srd/rules.json content/srd/sources.json content/srd/situations.json content/srd/races.json content/srd/domains.json \
            content/srd/classes/*.json content/srd/prestige/*.json content/srd/feats/*.json \
            content/srd/equipment/*.json content/srd/spells/*.json; do
  run "$file"
done

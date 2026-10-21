# Turns the extracted Tome of Battle feats (content/tools/out/tob/feats.json, from extract.py) into two work chunks for
# the agents who write content/srd/feats/tob.json: fixed ids, English names, labels, and the book's text to summarize.
# Chunks stay in content/tools/out/tob/ (git-ignored: book text).
# Usage: python3 content/tools/tob/prepare_feats.py
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'content/tools/out/tob'

TACTICAL = {'Clarion Commander', 'Distant Horizon', 'Faith Unswerving', 'Gloom Razor', 'Perfect Clarity of Mind and Body',
            'Reaping Talons', 'Scorching Sirocco', 'Shards of Granite', 'Stormguard Warrior'}
CATEGORY = {'Divine Spirit': 'divine', 'Instant Clarity': 'psionic', 'Psychic Renewal': 'psionic',
            'Scribe Martial Script': 'item_creation'}
# Table 2–1's footnote, and the warblade's bonus feat list.
FIGHTER_BONUS = {'Blade Meditation', 'Martial Stance', 'Martial Study'}
WARBLADE_BONUS = {'Blade Meditation', 'Ironheart Aura', 'Stone Power', 'Tiger Blooded', 'Unnerving Calm',
                  'White Raven Defense'}


def ident(name):
    return 'feat.' + re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def main():
    feats = json.load(open(OUT / 'feats.json'))
    existing = {e['id'] for f in (ROOT / 'content/srd/feats').glob('srd-*.json') for e in json.load(open(f))['entities']}
    entries = []
    for f in feats:
        name = f['name']
        labels = [CATEGORY.get(name, 'general')] + (['tactical'] if name in TACTICAL else [])
        labels += ['fighter_bonus'] * (name in FIGHTER_BONUS) + ['warblade_bonus'] * (name in WARBLADE_BONUS)
        entry = {'id': ident(name), 'en': name, 'labels': labels, 'bookText': f['text']}
        assert entry['id'] not in existing, entry['id']
        entries.append(entry)
    half = (len(entries) + 1) // 2
    for n, part in enumerate((entries[:half], entries[half:]), 1):
        (OUT / f'feats-{n}.json').write_text(json.dumps(part, ensure_ascii=False, indent=1))
    print(len(entries), 'feats')


if __name__ == '__main__':
    main()

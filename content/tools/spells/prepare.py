# Splits the scraped spells into work chunks for the agents: each chunk lists its spells with the scraped text, the
# lists they are on (class / domain and level), and the existing entity when one already exists (Bard batch, Danalieth).
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).parent / 'chunks'
OUT.mkdir(exist_ok=True)
data = json.load(open(ROOT / 'content/tools/out/spells.json'))

CLASSES = {'barde': ['class.bard'], 'druide': ['class.druid'], 'ensorceleur/magicien': ['class.sorcerer', 'class.wizard'],
           'paladin': ['class.paladin'], 'prêtre': ['class.cleric'], 'rôdeur': ['class.ranger']}


def list_targets(lst):
    m = re.match(r"Sorts d[e’'] ?(.+?) du niveau (\d)", lst['title'])
    if m:
        return [(c, int(m.group(2))) for c in CLASSES[m.group(1).strip()]], None
    return None, lst['title']


on_lists = {}
domains = []
for lst in data['lists']:
    targets, domain = list_targets(lst)
    if targets:
        for url in lst['spells']:
            for c, level in targets:
                on_lists.setdefault(url, []).append(f'{c} {level}')
    else:
        domains.append({'url': lst['url'], 'title': domain, 'items': lst['items'], 'spells': lst['spells']})
        for i, url in enumerate(lst['spells']):
            on_lists.setdefault(url, []).append(f'domaine {domain} {i + 1}')

def norm(t):
    return re.sub(r'[’‘]', "'", t.lower()).replace('-', ' ').strip()


existing = {}
for path in [ROOT / 'content/srd/spells/bard.json', ROOT / 'test-references/danalieth/catalog.json']:
    for e in json.load(open(path))['entities']:
        if e['type'] == 'spell':
            existing.setdefault(norm(e['name']['fr']), []).append({'from': str(path.relative_to(ROOT)), 'entity': e})

ALIASES = {'convocation de monstres 1': 'convocation de monstres i', 'force de taureau': 'force du taureau'}
for alias, name in ALIASES.items():
    existing[alias] = existing.get(name, [])

spells = []
for s in data['spells']:
    spells.append({'url': s['url'], 'title': s['title'], 'lists': on_lists.get(s['url'], []), 'text': '\n'.join(s['items']),
                   'tables': s['tables'], 'existing': existing.get(norm(s['title']), [])})
matched = {norm(s['title']) for s in spells}
unmatched = [k for k in existing if k not in matched and k not in ALIASES.values()]

SIZE = 20
chunks = [spells[i:i + SIZE] for i in range(0, len(spells), SIZE)]
for i, chunk in enumerate(chunks, 1):
    (OUT / f'{i:02}.json').write_text(json.dumps(chunk, ensure_ascii=False, indent=1))
(OUT / 'domains.json').write_text(json.dumps(domains, ensure_ascii=False, indent=1))
print(json.dumps({'spells': len(spells), 'chunks': len(chunks), 'domains': len(domains),
                  'without_list': [s['title'] for s in spells if not s['lists']],
                  'existing_matched': sum(1 for s in spells if s['existing']), 'existing_unmatched': unmatched}, ensure_ascii=False))

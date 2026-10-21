# Builds content/srd/classes/<class>.json from the scraped tables (content/tools/out) and the curated data in this folder.
# Tome of Battle classes (`tobTable`) read their table from content/tools/out/tob/classes.json (content/tools/tob).
# Usage: python3 gen.py <repo root> druid sorcerer ...
import importlib.util, json, re, sys
from pathlib import Path

ROOT = Path(sys.argv[1])
HERE = Path(__file__).parent


def num(cell):
    m = re.match(r'[+–-]?\d+', cell.replace('–', '-'))
    return int(m.group(0)) if m else None


def spell_cell(cell):
    cell = cell.strip()
    if cell in ('—', '-', '”', '"', ''):
        return None
    return int(re.match(r'\d+', cell).group(0))


def table(section, url_suffix, index=0):
    pages = json.load(open(ROOT / f'content/tools/out/{section}.json'))
    page = next(p for p in pages if p['url'].endswith(url_suffix))
    return page['tables'][index]


def describe(paragraph, rules):
    return paragraph.strip() + '\n\nEn jeu\n' + '\n'.join('• ' + r for r in rules)


def build(mod):
    c = mod.CLASS
    cid = f"class.{c['id']}"
    cls = {
        'id': cid, 'type': 'class', 'name': {'fr': c['fr'], 'en': c['en']}, 'provenance': 'official',
        'labels': ['class', 'base'] + c.get('labels', []),
        'description': {'fr': describe(c['text'], c['rules'])},
        'hitDie': c['hitDie'],
        'skillPoints': c['skillPoints'],
    }
    if c.get('source'):
        cls['source'] = c['source']
    if 'spellcasting' in c:
        cls['spellcasting'] = c['spellcasting']
    if 'initiating' in c:
        cls['initiating'] = c['initiating']
    cls['effects'] = c.get('effects', [])
    # SRD epic bonus feats: one every N class levels past 20 (class features keep coming at class level).
    every = c.get('epicBonusFeatEvery')
    if every:
        cls['effects'].append({'target': 'feat_slots.epic_bonus', 'op': 'add', 'value': f"max(0, floor((level('{cid}') - 20) / {every}))", 'bonusType': 'untyped'})
    if c.get('note'):
        cls['note'] = c['note']
    entities = [cls]
    grants = {}
    for p in mod.POWERS:
        e = {
            'id': f"power.{c['id']}_{p['id']}", 'type': 'class_power', 'name': {'fr': p['fr'], 'en': p['en']},
            'provenance': 'official', **({'source': c['source']} if c.get('source') else {}),
            'labels': ['class_power', c['id']],
            'description': {'fr': describe(p['text'], p['rules'])},
            'effects': p.get('effects', []),
        }
        for key in ('usesPerDay', 'tableValue', 'note'):
            if key in p:
                e[key] = p[key]
        entities.append(e)
        grants.setdefault(p['level'], []).append(e['id'])

    if c.get('tobTable'):
        progressions = [{'classId': cid, 'level': r['level'], 'bab': r['bab'], 'fort': r['fort'], 'ref': r['ref'],
                         'will': r['will'], 'grants': grants.get(r['level'], []), 'maneuversKnown': r['maneuversKnown'],
                         'maneuversReadied': r['maneuversReadied'], 'stancesKnown': r['stancesKnown']}
                        for r in json.load(open(ROOT / 'content/tools/out/tob/classes.json'))[c['id']]]
    else:
        progressions = rows_from_table(c, cid, grants)

    relations = [{'from': cid, 'relation': 'class_skill', 'to': s} for s in c['skills']]
    relations += [{'from': cid, 'relation': 'proficiency', 'to': p} for p in c['proficiencies']]
    relations += [{'from': cid, 'relation': 'alignment', 'to': f'alignment.{a}'} for a in c['alignments']]
    relations += [{'from': cid, 'relation': 'initiates', 'to': f'discipline.{d}'} for d in c.get('disciplines', [])]
    # A power that gives a feat grants it, so `has('feat.track')` holds and the feat comes with the closure.
    relations += [{'from': f"power.{c['id']}_{p['id']}", 'relation': 'grants', 'to': p['feat']} for p in mod.POWERS if 'feat' in p]
    return {'entities': entities, 'progressions': progressions, 'relations': relations}


def rows_from_table(c, cid, grants):
    rows = table(*c['table'])
    header = rows[0]
    spells_at = header.index('Spécial') + 1 if c.get('spellColumns') else None
    progressions = []
    for cells in rows[1:]:
        level = int(cells[0])
        row = {'classId': cid, 'level': level, 'bab': num(cells[1]), 'fort': num(cells[3]), 'ref': num(cells[2]),
               'will': num(cells[4]), 'grants': grants.get(level, [])}
        if spells_at is not None:
            per_day = [spell_cell(x) for x in cells[spells_at:spells_at + c['spellColumns']]]
            row['spellsPerDay'] = [None] * c.get('firstSpellLevel', 0) + per_day
        progressions.append(row)
    if c.get('knownTable'):
        known = table(*c['knownTable'])
        for row, cells in zip(progressions, known[1:]):
            assert int(cells[0]) == row['level']
            row['spellsKnown'] = [spell_cell(x) for x in cells[1:]]
    return progressions


for name in sys.argv[2:]:
    spec = importlib.util.spec_from_file_location(name, HERE / f'{name}.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = ROOT / f'content/srd/classes/{name}.json'
    out.write_text(json.dumps(build(mod), ensure_ascii=False, indent=2) + '\n')
    print(out)

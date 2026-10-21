# Turns the extracted Tome of Battle maneuvers (content/tools/out/tob/maneuvers.json, from extract.py) into work chunks
# for the agents who write the batches: fixed ids, English names, the `maneuver` block with its values in French, the
# labels, and the book's text to summarize. Chunks stay in content/tools/out/tob/chunks/ (git-ignored: book text).
# Usage: python3 content/tools/tob/prepare.py
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'content/tools/out/tob'
CHUNK = 25

DISCIPLINES = {
    'Desert Wind': 'desert_wind', 'Devoted Spirit': 'devoted_spirit', 'Diamond Mind': 'diamond_mind',
    'Iron Heart': 'iron_heart', 'Setting Sun': 'setting_sun', 'Shadow Hand': 'shadow_hand',
    'Stone Dragon': 'stone_dragon', 'Tiger Claw': 'tiger_claw', 'White Raven': 'white_raven',
}
NUMBERS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5}
ALIGNMENTS = {'evil': 'alignement mauvais', 'good': 'alignement bon', 'lawful': 'alignement loyal',
              'chaotic': 'alignement chaotique'}

# Every stat value of the book, after `squash` (letter spacing and line-break hyphens removed, lower case).
VALUES = {
    '1standardaction': '1 action simple', 'standardaction': '1 action simple', '1swiftaction': '1 action rapide',
    '1fullroundaction': '1 action complexe', '1fullround': '1 action complexe', '1immediateaction': '1 action immédiate',
    'meleeattack': 'attaque au corps à corps', 'meleeattack;seetext': 'attaque au corps à corps (voir texte)',
    'personal': 'personnelle', '60ft.': '18 m', '50ft.': '15 m', '1moveaction': '1 action de mouvement', 'alliedcreatureswithin30ft.': 'les créatures alliées à 9 m ou moins', '30ft.': '9 m', '20ft.': '6 m', '10ft.': '3 m', 'touch': 'contact',
    'special': 'spéciale', 'special;seetext': 'spéciale (voir texte)', 'touchand60ft.;seetext': 'contact et 18 m (voir texte)',
    'you': 'vous', 'onecreature': 'une créature', 'creaturetouched': 'créature touchée',
    'creaturetouched;seetext': 'créature touchée (voir texte)', 'oneormorecreatures': 'une ou plusieurs créatures',
    'onecreatureorunattendedobject': 'une créature ou un objet non tenu', 'alladjacentopponents': 'tous les adversaires adjacents',
    'twocreatures': 'deux créatures', 'onelivingcreature': 'une créature vivante',
    'oneflatfootedlivingcreature': 'une créature vivante prise au dépourvu', 'creatureorobjectstruck': 'créature ou objet frappé',
    'creaturestruck': 'créature frappée', 'onecreature;seetext': 'une créature (voir texte)', 'oneally': 'un allié',
    'youandoneallywithin10ft.': 'vous et un allié à 3 m ou moins',
    'oneormoreadjacentcreaturesyouthreaten': 'une ou plusieurs créatures adjacentes que vous menacez',
    'youandalliedcreatureswithin60ft.': 'vous et les créatures alliées à 18 m ou moins',
    'cone': 'cône', '60ft.radiusemanationcenteredonyou': 'émanation de 18 m de rayon centrée sur vous',
    '30ft.radiusburstcenteredonyou': 'explosion de 9 m de rayon centrée sur vous',
    '60ft.radiusburstcenteredonyou': 'explosion de 18 m de rayon centrée sur vous',
    '20ft.radiusburst,centeredonyou': 'explosion de 6 m de rayon centrée sur vous',
    '30ft.radiusburst;seetext': 'explosion de 9 m de rayon (voir texte)',
    'variablespread;seetext': 'étendue variable (voir texte)', 'one5ftsquareper5ft.ofmovement': 'une case de 1,50 m par 1,50 m de déplacement',
    '30ft.line': 'ligne de 9 m', '60ft.line': 'ligne de 18 m', 'onesummonedfireelemental': 'un élémentaire de feu convoqué',
    'stance': 'posture', '1round': '1 round', 'instantaneous': 'instantanée', 'endofturn': 'jusqu’à la fin du tour',
    '1minute': '1 minute', 'seetext': 'voir texte', '1round;seetext': '1 round (voir texte)',
    '3rounds;seetext': '3 rounds (voir texte)', 'instantaneous;5rounds;seetext(d)': 'instantanée ; 5 rounds (voir texte) (T)',
    'instantaneous;seetext': 'instantanée (voir texte)', '1d3rounds': '1d3 rounds',
    '1roundormore;seetext': '1 round ou plus (voir texte)', '3rounds': '3 rounds',
    'fortitudepartial': 'Vigueur, partiel', 'reflexhalf': 'Réflexes, ½ dégâts', 'fortitudenegates': 'Vigueur, annule',
    'willnegates': 'Volonté, annule', 'reflexhalf;seetext': 'Réflexes, ½ dégâts (voir texte)',
    'fortitudepartial;seetext': 'Vigueur, partiel (voir texte)', 'reflexpartial': 'Réflexes, partiel',
    'fortitudehalf': 'Vigueur, ½ dégâts', 'willhalf': 'Volonté, ½ dégâts', 'reflexnegates': 'Réflexes, annule',
    'reflexpartial;seetext': 'Réflexes, partiel (voir texte)', 'willpartial;seetext': 'Volonté, partiel (voir texte)',
}
DESCRIPTORS = {'Fire': 'feu', 'Chaos': 'chaos', 'Law': 'loi', 'Good': 'bien', 'Evil': 'mal', 'Teleport': 'téléportation', 'Teleportation': 'téléportation'}
FIELDS = {'Initiation Action': 'initiationAction', 'Range': 'range', 'Target': 'target', 'Targets': 'target',
          'Area': 'area', 'Effect': 'effect', 'Duration': 'duration', 'Saving Throw': 'savingThrow'}
# Fixed by hand: values the PDF breaks (Stalking Shadow loses its action line).
FIXES = {'STALKING SHADOW': {'Initiation Action': '1 immediate action', 'Prerequisite': 'Two Setting Sun maneuvers'}}


def squash(text):
    return re.sub(r'[\s-]', '', text).lower()


def french(field, value):
    key = squash(value)
    if key not in VALUES:
        raise SystemExit(f'no French for {field}: {value!r}')
    return VALUES[key]


def unhyphen(text):
    return re.sub(r'(\w)- (\w)', r'\1\2', text)


def list_names():
    """English names in the book's case, and the one-line summaries, from the maneuver lists (pages 48-51)."""
    pages = json.load(open(OUT / 'pages.json'))
    text = unhyphen(' '.join(pages[48:52]))
    text = text[text.find('MANEUVER AND'):]
    for kind in ('Strike', 'Boost', 'Counter', 'Stance'):
        text = re.sub(r'\s*'.join(kind) + r'\s*—', kind + '—', text)
    found = {}
    for m in re.finditer(r"([A-Z][A-Za-z’' ,-]+?)\s*:\s*(Strike|Boost|Counter|Stance)\s*—\s*(.+?)(?=\s+[A-Z][A-Za-z’' ,-]+?\s*:\s*(?:Strike|Boost|Counter|Stance)\s*—|\s+\d+(?:ST|ND|RD|TH) LEVEL|$)", text, re.S):
        # The first entry of each discipline starts with its short name (« Iron Punishing Stance »), kept here.
        name = re.sub(r'\s+', ' ', m.group(1).strip())
        # Letter-spaced words: « Strike of t h e Broken Shield ».
        name = re.sub(r'(?<!\w)(?:\w ){2,}\w(?!\w)', lambda w: w.group(0).replace(' ', ''), name)
        name = re.sub(r'\b([A-Z]) (?=[a-z])', r'\1', name)  # « Crushing W eight of the Mountain »
        found[squash(name).replace('’', "'")] = (name, re.sub(r'\s+', ' ', m.group(3)).strip())
    return found


PREFIXES = ['desert', 'devo', 'diam', 'iron', 'set', 'shadow', 'stone', 'tiger', 'white']


def lookup(names, key):
    # The lists also add « Stance » to a few stance names (« Absolute Steel Stance »).
    for prefix in [''] + PREFIXES:
        for suffix in ('', 'stance'):
            if prefix + key + suffix in names:
                name, summary = names[prefix + key + suffix]
                name = name.split(' ', 1)[1] if prefix else name
                return (name.removesuffix(' Stance') if suffix else name), summary
    return None


def ident(name):
    name = name.replace('’', "'")
    m = re.match(r'(.+), (Greater|Lesser)$', name)
    if m:
        name = f'{m.group(2)} {m.group(1)}'
    return re.sub(r'[^a-z0-9]+', '_', name.lower().replace("'", '')).strip('_')


def main():
    raw = json.load(open(OUT / 'maneuvers.json'))
    names = list_names()
    entries = []
    for m in raw:
        stats = {**m['stats'], **FIXES.get(m['name'], {})}
        key = squash(m['name']).replace('’', "'")
        # The lists write « Greater Divine Surge » where the block says « DIVINE SURGE, GREATER ».
        reverse = squash(' '.join(reversed(m['name'].split(', ')))).replace('’', "'")
        # The blocks with no kind are also missing from the lists' « Kind— » format: their name comes from the block.
        title = re.sub(r"\b(Of|The|From|In|On)\b", lambda w: w.group(0).lower(), m['name'].title()).replace('’S', '’s')
        name, summary = lookup(names, key) or lookup(names, reverse) or (title, '')
        if ', ' not in name and ', ' in m['name']:
            parts = name.split(' ', 1)
            name = f'{parts[1]}, {parts[0]}'
        # Five blocks print no kind; none of them attacks, so they are boosts (with a note saying so).
        kind = m['kind'] or 'boost'
        prerequisite = unhyphen(stats.get('Prerequisite') or '')
        # « Two Desert Wind maneuvers »; the PDF sometimes spaces the letters (« F i v e »).
        requires = next((n for word, n in NUMBERS.items() if squash(prerequisite).startswith(word)), 0)
        alignment = next((fr for en, fr in ALIGNMENTS.items() if f'{en} alignment' in prerequisite.lower()), None)
        block = {'discipline': 'discipline.' + DISCIPLINES[m['discipline']], 'level': m['level'], 'kind': kind}
        if m['descriptors']:
            block['descriptors'] = [DESCRIPTORS[d.strip()] for d in m['descriptors'].split(',')]
        if requires:
            block['requires'] = requires
        if alignment:
            block['prerequisite'] = alignment
        for field, key2 in FIELDS.items():
            if stats.get(field):
                block[key2] = french(field, stats[field])
        text = unhyphen(m['text'])
        labels = [kind] if kind != 'stance' else []
        if 'supernatural ability' in text.replace('  ', ' ').lower() or 'supernatural' in squash(text[-60:]):
            labels.append('supernatural')
        entries.append({
            'id': f"{'stance' if kind == 'stance' else 'maneuver'}.{ident(name)}",
            'type': 'stance' if kind == 'stance' else 'maneuver',
            'en': name,
            'classes': m['classes'],
            'labels': labels,
            'maneuver': block,
            **({} if m['kind'] else {'note': 'Le livre ne donne pas de type à cette manœuvre : classée renforcement.'}),
            'bookSummary': summary,
            'bookText': text,
        })
    ids = [e['id'] for e in entries]
    assert len(set(ids)) == len(ids), 'duplicate ids'
    assert all(e['maneuver'].get('initiationAction') for e in entries), 'an action is missing'
    entries.sort(key=lambda e: (e['maneuver']['discipline'], e['maneuver']['level'], e['id']))
    chunks = OUT / 'chunks'
    chunks.mkdir(exist_ok=True)
    for n in range(0, len(entries), CHUNK):
        part = entries[n:n + CHUNK]
        (chunks / f'{n // CHUNK + 1:02d}.json').write_text(json.dumps(part, ensure_ascii=False, indent=1))
    json.dump(ids, open(OUT / 'ids.json', 'w'), indent=1)
    print(len(entries), 'entries,', (len(entries) + CHUNK - 1) // CHUNK, 'chunks')


if __name__ == '__main__':
    main()

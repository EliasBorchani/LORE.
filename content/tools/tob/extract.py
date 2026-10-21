# Extracts the Tome of Battle PDF (owner's copy, never committed) into content/tools/out/tob/ (git-ignored), only for
# curation: page texts, maneuver and stance stat blocks, and the three class tables.
# Run: <venv with pypdf>/bin/python -I content/tools/tob/extract.py <pdf>
import json, re, sys
from pathlib import Path
import pypdf

OUT = Path(__file__).resolve().parents[1] / 'out' / 'tob'
DISCIPLINES = ['Desert Wind', 'Devoted Spirit', 'Diamond Mind', 'Iron Heart', 'Setting Sun', 'Shadow Hand',
               'Stone Dragon', 'Tiger Claw', 'White Raven']
KINDS = ['Strike', 'Boost', 'Counter', 'Stance']
FIELDS = ['Level', 'Class', 'Prerequisite', 'Initiation Action', 'Range', 'Target', 'Targets', 'Area', 'Effect', 'Duration',
          'Saving Throw']


def clean(text):
    text = text.replace('ﬁ ', 'fi').replace('ﬂ  ', 'fl').replace('ﬂ ', 'fl').replace('ﬁ', 'fi').replace('ﬂ', 'fl')
    # Justified lines sometimes come out letter-spaced: "a l l o w s  y o u" -> "allows you".
    def unspace(m):
        return ' '.join(w.replace(' ', '') for w in m.group(0).split('  '))
    return re.sub(r'(?:\b\w (?:\w ){3,}\w\b)(?:  (?:\w ?)+)*', unspace, text)


def pages(pdf):
    reader = pypdf.PdfReader(pdf)
    return [fix_headers(clean(p.extract_text() or '')) for p in reader.pages]


# « Iron Heart (Stance) [Fire] ». Three blocks print no kind (Shadow Blink, Shadow Jaunt, Order Forged from Chaos):
# the kind is then None and prepare.py decides.
HEADER = re.compile(r'^(%s)(?: \((%s)\))?\s*(\[[^\]]+\])?\s*$' % ('|'.join(DISCIPLINES), '|'.join(KINDS)))


def fix_headers(text):
    """Headers the layout breaks: « Shadow Hand » / « (Strike) » on two lines, « Desert Wind 8 (Stance) »."""
    text = re.sub(r'(%s) *\n\((%s)\)' % ('|'.join(DISCIPLINES), '|'.join(KINDS)), r'\1 (\2)', text)
    return re.sub(r'^(%s) \d+ \(' % '|'.join(DISCIPLINES), r'\1 (', text, flags=re.M)


def maneuvers(texts):
    found = []
    for page_no, text in enumerate(texts):
        lines = [l.rstrip() for l in text.split('\n')]
        for i, line in enumerate(lines):
            m = HEADER.match(line.strip())
            if not m or i == 0 or i + 1 >= len(lines) or not lines[i + 1].strip().startswith(('Level', 'Class')):
                continue
            # The name is the all-caps line(s) just above the discipline line.
            j = i - 1
            name_lines = []
            while j >= 0 and lines[j].strip() and lines[j].strip().upper() == lines[j].strip() and re.search('[A-Z]', lines[j]):
                name_lines.insert(0, lines[j].strip())
                j -= 1
            found.append({'page': page_no, 'line': i, 'name': ' '.join(name_lines), 'name_lines': len(name_lines), 'discipline': m.group(1),
                          'kind': m.group(2) and m.group(2).lower(), 'descriptors': (m.group(3) or '').strip('[]') or None})
    # Each block runs until the next header on the same flow (or 400 lines further across pages).
    flow = [(p, l) for p, t in enumerate(texts) for l in t.split('\n')]
    index = {}
    k = 0
    for p, t in enumerate(texts):
        for i, _ in enumerate(t.split('\n')):
            index[(p, i)] = k
            k += 1
    starts = [index[(f['page'], f['line'])] for f in found]
    for n, f in enumerate(found):
        start = starts[n] + 1
        end = starts[n + 1] - found[n + 1]['name_lines'] if n + 1 < len(found) else min(len(flow), start + 120)
        body = [flow[x][1] for x in range(start, max(start, end))]
        f.update(parse_block(body))
        if 'Class' in f['stats']:
            f['stats']['Level'] = f['stats'].pop('Class')
        f['level'] = int(re.search(r'\d', f['stats']['Level']).group())
        f['classes'] = sorted({c for c in ('crusader', 'swordsage', 'warblade')
                               if c in re.sub(r'[\s-]', '', f['stats']['Level'].lower())})
        del f['line']
    for f in found:
        del f['name_lines']
    return found


JUNK = re.compile(r'\.indd|^Illus\. by|^\d+$|^Maneuvers and Stances')


def parse_block(lines):
    lines = [l.strip() for l in lines if l.strip() and not JUNK.search(l.strip())]
    field = re.compile(r'^(%s)\s*:\s*(.*)$' % '|'.join(FIELDS))
    # Captions of illustrations can fall between stat lines: anything before the last stat line that does not continue
    # the previous one is dropped.
    heads = [i for i, l in enumerate(lines[:25]) if field.match(l)]
    last = heads[-1] if heads else -1
    stats, text, current = {}, [], None
    for i, s in enumerate(lines):
        m = field.match(s)
        if m and i <= last:
            current = m.group(1)
            stats[current] = m.group(2).strip()
            continue
        v = stats.get(current, '')
        continues = current and not text and (
            v.endswith(('-', ',', ' or', ' and', ';')) or re.match(r'^[a-z(]', s)
            or (current == 'Prerequisite' and 'maneuver' not in v and 'alignment' not in v))
        if continues:
            stats[current] = (v + ' ' + s).strip()
        elif i < last:
            continue
        else:
            text.append(s)
    return {'stats': stats, 'text': ' '.join(text)}


CLASS_TABLES = {'crusader': 'Table 1–1', 'swordsage': 'Table 1–2', 'warblade': 'Table 1–3'}
ROW = re.compile(r'^(\d+)(?:st|nd|rd|th) \+(\d+)\S* \+(\d+) \+(\d+) \+(\d+) (.*?) ?(\d+) (\d+)(?: \((\d+)\))? (\d+)$')


def class_tables(texts):
    """The three class tables: base attack, saves, features, maneuvers known / readied (granted) / stances known."""
    tables = {}
    for name, title in CLASS_TABLES.items():
        text = next(t for t in texts if title + ':' in t)
        rows = []
        for line in text[text.index(title + ':'):].split('\n'):
            m = ROW.match(re.sub(r'\s+', ' ', line.strip()))
            if m:
                level, bab, fort, ref, will, special, known, readied, granted, stances = m.groups()
                rows.append({'level': int(level), 'bab': int(bab), 'fort': int(fort), 'ref': int(ref), 'will': int(will),
                             'special': special, 'maneuversKnown': int(known), 'maneuversReadied': int(readied),
                             'granted': int(granted) if granted else None, 'stancesKnown': int(stances)})
        assert [r['level'] for r in rows] == list(range(1, 21)), (name, [r['level'] for r in rows])
        tables[name] = rows
    return tables


FEATS = ['Adaptive Style', 'Avenging Strike', 'Blade Meditation', 'Desert Fire', 'Desert Wind Dodge', 'Devoted Bulwark',
         'Divine Spirit', 'Evasive Reflexes', 'Extra Granted Maneuver', 'Extra Readied Maneuver', 'Falling Sun Attack',
         'Instant Clarity', 'Ironheart Aura', 'Martial Stance', 'Martial Study', 'Psychic Renewal', 'Rapid Assault',
         'Scribe Martial Script', 'Shadow Blade', 'Shadow Trickster', 'Song of the White Raven', 'Snap Kick',
         'Stone Power', 'Sudden Recovery', 'Superior Unarmed Strike', 'Tiger Blooded', 'Unnerving Calm',
         'Vital Recovery', 'White Raven Defense', 'Clarion Commander', 'Distant Horizon', 'Faith Unswerving',
         'Gloom Razor', 'Perfect Clarity of Mind and Body', 'Reaping Talons', 'Scorching Sirocco', 'Shards of Granite',
         'Stormguard Warrior']


def feats(texts):
    """The 38 feats of chapter 2 (pages 28-37): English name, kind ([Tactical]…), and the text up to the next feat."""
    text = '\n'.join(texts[28:38])
    text = text[text.index('ADAPTIVE STYLE'):text.index('MARTIAL POWERS')]
    # The feats table sits in the middle of the text, up to its page footer.
    text = re.sub(r'Table 2–1:.*?\.indd[^\n]*\n', '', text, flags=re.S)
    lines = [l.strip() for l in text.split('\n') if l.strip() and not JUNK.search(l.strip())]
    # Join the headings printed on two lines (« SUDDEN » / « RECOVERY »).
    caps = lambda l: re.fullmatch(r"[A-Z][A-Z’' ,-]+(\s*\[[A-Z]+\])?", l) is not None
    joined = []
    for line in lines:
        if joined and caps(line) and caps(joined[-1]) and squash_upper(joined[-1]) not in NAMES:
            joined[-1] += ' ' + line
        else:
            joined.append(line)
    found, current = [], None
    for line in joined:
        m = re.fullmatch(r"(.+?)\s*(?:\[([A-Z]+)\])?", line) if caps(line) else None
        if m and squash_upper(m.group(1)) in NAMES:
            current = {'name': NAMES[squash_upper(m.group(1))], 'kind': (m.group(2) or 'general').lower(), 'text': []}
            found.append(current)
        elif current:
            current['text'].append(line)
    for f in found:
        f['text'] = ' '.join(f['text'])
    assert [f['name'] for f in found] == FEATS, [f['name'] for f in found]
    return found


def squash_upper(text):
    return re.sub(r'[^A-Z]', '', text.upper())


NAMES = {squash_upper(n): n for n in FEATS}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    texts = pages(sys.argv[1])
    json.dump(texts, open(OUT / 'pages.json', 'w'), ensure_ascii=False, indent=1)
    found = maneuvers(texts)
    json.dump(found, open(OUT / 'maneuvers.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(class_tables(texts), open(OUT / 'classes.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(feats(texts), open(OUT / 'feats.json', 'w'), ensure_ascii=False, indent=1)
    by = {}
    for f in found:
        by.setdefault(f['discipline'], []).append(f['kind'])
    for d in DISCIPLINES:
        print(d, len(by.get(d, [])), 'stances:', by.get(d, []).count('stance'))
    print('total', len(found))


if __name__ == '__main__':
    main()

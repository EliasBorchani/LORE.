# Shared by paladin_variant.py and ranger_variant.py: the SRD class's features without the spells. A feature whose
# effects do not read the class level is granted by its existing id (`reuse`); the others are copied under the
# variant's own id so their formulas read the variant's level (and toggles, `toggle.<class>_<feature>`).
import importlib.util, json
from pathlib import Path

HERE = Path(__file__).parent


def load(base):
    spec = importlib.util.spec_from_file_location(base, HERE / f'{base}.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rows(base):
    srd = json.load(open(HERE.parent.parent / f'srd/classes/{base}.json'))
    return [{k: r[k] for k in ('level', 'bab', 'fort', 'ref', 'will')} for r in srd['progressions']]


def powers(base, drop, variant):
    out = []
    for p in load(base).POWERS:
        if p['id'] in drop:
            continue
        blob = json.dumps([p.get('effects', []), p.get('usesPerDay', '')])
        if f"class.{base}" in blob or f"toggle.{base}_" in blob:
            q = json.loads(json.dumps(p).replace(f"class.{base}'", f"class.{variant}'").replace(f"toggle.{base}_", f"toggle.{variant}_"))
            q['effects'] = q.get('effects', [])
            out.append(q)
        else:
            out.append({'level': p['level'], 'reuse': f"power.{base}_{p['id']}"})
    return out

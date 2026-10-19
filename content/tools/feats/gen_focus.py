# Spell Focus and Greater Spell Focus per school, Skill Focus per skill: one entity per option, as in Danalieth's
# catalog (`feat.spell_focus_abjuration`), so a character can take them for several schools or skills.
# Danalieth's three keep their effects, statuses and notes. Usage: python3 content/tools/feats/gen_focus.py
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
danalieth = {e['id']: e for e in json.load(open(ROOT / 'test-references/danalieth/catalog.json'))['entities']}
skills = [e for e in json.load(open(ROOT / 'content/srd/rules.json'))['entities']
          if e['type'] == 'skill' and e['id'] not in ('skill.knowledge', 'skill.speak_language')]

SCHOOLS = {'abjuration': 'abjuration', 'conjuration': 'invocation', 'divination': 'divination',
           'enchantment': 'enchantement', 'evocation': 'évocation', 'illusion': 'illusion',
           'necromancy': 'nécromancie', 'transmutation': 'transmutation'}

SPELL_FOCUS = """Certains mages touchent à tout. D’autres choisissent une école et n’en sortent plus : ils en connaissent chaque formule par cœur, chaque geste au millimètre, et leurs sorts y mordent plus profond que ceux des autres.

En jeu
• +1 au DD des jets de sauvegarde contre les sorts d’{fr}.
• Un don par école : il peut être pris pour plusieurs écoles."""
GREATER = """Des années plus tard, la spécialité est devenue une signature : les sorts d’{fr} de ce lanceur se reconnaissent de loin, et on leur résiste encore moins bien qu’avant.

En jeu
• Condition : École renforcée ({fr}).
• +1 de plus au DD des jets de sauvegarde contre les sorts d’{fr} (+2 au total avec École renforcée).
• Un don par école : il peut être pris pour plusieurs écoles."""
SKILL = """Tout le monde sait un peu de tout. Ce personnage, lui, a un domaine où il n’a presque pas d’égal, et il le sait.

En jeu
• +3 aux tests d’{fr}.
• Un don par compétence : il peut être pris pour plusieurs compétences."""


def elide(fr, text):
    return text.replace('d’{fr}', ('d’' if fr[0] in 'aeiouéèhAEIOUÉ' else 'de ') + '{fr}').format(fr=fr)


def feat(fid, fr, en, labels, text, effects, prerequisite=None):
    old = danalieth.get(fid)
    e = {'id': fid, 'type': 'feat', 'name': {'fr': fr, 'en': en}, 'provenance': 'official', 'source': 'SRD',
         'labels': labels, 'description': {'fr': text}}
    if prerequisite:
        e['prerequisite'] = prerequisite
    e['effects'] = effects
    if old:
        e['name'] = old['name']
        e['effects'] = old['effects'] + [x for x in effects if x['target'] not in {o['target'] for o in old['effects']}]
        for k in ('status', 'note'):
            if k in old:
                e[k] = old[k]
    return e


entities, relations = [], []
for school, fr in SCHOOLS.items():
    focus, greater = f'feat.spell_focus_{school}', f'feat.greater_spell_focus_{school}'
    entities.append(feat(focus, f'École renforcée ({fr})', f'Spell Focus ({school})', ['general', 'magic', 'DC'],
                         elide(fr, SPELL_FOCUS),
                         [{'target': f'dc.school[{school}]', 'op': 'add', 'value': 1, 'bonusType': 'untyped'},
                          {'target': 'feats.spell_focus.schools', 'op': 'add', 'value': 1}]))
    entities.append(feat(greater, f'École supérieure ({fr})', f'Greater Spell Focus ({school})', ['general', 'magic', 'DC'],
                         elide(fr, GREATER), [{'target': f'dc.school[{school}]', 'op': 'add', 'value': 1, 'bonusType': 'untyped'}],
                         f"has('{focus}')"))
    relations.append({'from': greater, 'relation': 'requires', 'to': focus})
for s in skills:
    key = s['id'].removeprefix('skill.')
    fr = s['name']['fr']
    entities.append(feat(f'feat.skill_focus_{key}', f'Talent ({fr})', f"Skill Focus ({s['name']['en']})", ['general', 'skill'],
                         elide(fr, SKILL), [{'target': s['id'], 'op': 'add', 'value': 3, 'bonusType': 'untyped'}]))

out = ROOT / 'content/srd/feats/focus.json'
out.write_text(json.dumps({'entities': entities, 'relations': relations}, ensure_ascii=False, indent=2) + '\n')
print(f'{len(entities)} feats -> {out.relative_to(ROOT)}')

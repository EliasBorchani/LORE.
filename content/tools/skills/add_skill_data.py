# Adds the SRD skill data to content/srd/rules.json: each skill's `skill` block (ability, armor check penalty, trained
# only) and its synergies (5 ranks give +2 to another skill; conditional ones carry a situation). Run once; it
# rewrites the skill entities' `skill` and `effects` fields.
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / 'content/srd/rules.json'

# id: (ability, armor check penalty multiplier, trained only)
SKILLS = {
    'appraise': ('int', 0, False), 'balance': ('dex', 1, False), 'bluff': ('cha', 0, False), 'climb': ('str', 1, False),
    'concentration': ('con', 0, False), 'craft': ('int', 0, False), 'decipher_script': ('int', 0, True),
    'diplomacy': ('cha', 0, False), 'disable_device': ('int', 0, True), 'disguise': ('cha', 0, False),
    'escape_artist': ('dex', 1, False), 'forgery': ('int', 0, False), 'gather_information': ('cha', 0, False),
    'handle_animal': ('cha', 0, True), 'heal': ('wis', 0, False), 'hide': ('dex', 1, False), 'intimidate': ('cha', 0, False),
    'jump': ('str', 1, False), 'listen': ('wis', 0, False), 'move_silently': ('dex', 1, False), 'open_lock': ('dex', 0, True),
    'perform': ('cha', 0, False), 'profession': ('wis', 0, True), 'ride': ('dex', 0, False), 'search': ('int', 0, False),
    'sense_motive': ('wis', 0, False), 'sleight_of_hand': ('dex', 1, True), 'spellcraft': ('int', 0, True),
    'spot': ('wis', 0, False), 'survival': ('wis', 0, False), 'swim': ('str', 2, False), 'tumble': ('dex', 1, True),
    'use_magic_device': ('cha', 0, True), 'use_rope': ('dex', 0, False),
    **{f'knowledge_{k}': ('int', 0, True) for k in ['arcana', 'architecture', 'dungeoneering', 'geography', 'history',
                                                    'local', 'nature', 'nobility', 'planes', 'religion']},
}

# from: [(to statistic, situation or None)]
SYNERGIES = {
    'bluff': [('skill.diplomacy', None), ('skill.intimidate', None), ('skill.sleight_of_hand', None),
              ('skill.disguise', 'situation.acting_in_character')],
    'craft': [('skill.appraise', 'situation.items_of_your_craft')],
    'decipher_script': [('skill.use_magic_device', 'situation.scrolls')],
    'escape_artist': [('skill.use_rope', 'situation.binding_someone')],
    'handle_animal': [('skill.ride', None), ('check.wild_empathy', None)],
    'jump': [('skill.tumble', None)],
    'knowledge_arcana': [('skill.spellcraft', None)],
    'knowledge_architecture': [('skill.search', 'situation.secret_doors')],
    'knowledge_dungeoneering': [('skill.survival', 'situation.underground')],
    'knowledge_geography': [('skill.survival', 'situation.not_getting_lost')],
    'knowledge_local': [('skill.gather_information', None)],
    'knowledge_nature': [('skill.survival', 'situation.natural_aboveground')],
    'knowledge_nobility': [('skill.diplomacy', None)],
    'knowledge_planes': [('skill.survival', 'situation.other_planes')],
    # Knowledge (religion) +2 on turning checks: no turning check statistic yet.
    'search': [('skill.survival', 'situation.following_tracks')],
    'sense_motive': [('skill.diplomacy', None)],
    'spellcraft': [('skill.use_magic_device', 'situation.scrolls')],
    'survival': [('skill.knowledge_nature', None)],
    'tumble': [('skill.balance', None), ('skill.jump', None)],
    'use_magic_device': [('skill.spellcraft', 'situation.deciphering_scrolls')],
    'use_rope': [('skill.climb', 'situation.climbing_a_rope'), ('skill.escape_artist', 'situation.rope_bonds')],
}

data = json.loads(PATH.read_text())
seen = set()
for e in data['entities']:
    key = e['id'].removeprefix('skill.')
    if e['type'] != 'skill' or key not in SKILLS:
        continue
    seen.add(key)
    ability, penalty, trained = SKILLS[key]
    e['skill'] = {'ability': ability, **({'armorCheckPenalty': penalty} if penalty else {}), **({'trainedOnly': True} if trained else {})}
    effects = []
    for target, situation in SYNERGIES.get(key, []):
        effect = {'target': target, 'op': 'add', 'value': 2, 'bonusType': 'untyped', 'condition': f"@{e['id']}.ranks >= 5"}
        if situation:
            effect['situation'] = situation
        effects.append(effect)
    if effects:
        e['effects'] = effects
    else:
        e.pop('effects', None)
assert seen == set(SKILLS), set(SKILLS) - seen
PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(f'{len(seen)} skills, {sum(len(v) for v in SYNERGIES.values())} synergies')

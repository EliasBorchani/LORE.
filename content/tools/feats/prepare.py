# Splits the scraped feats into work chunks for the agents. Every feat gets its id here, so chunks can name each
# other's feats (`requires`, prerequisites) before they are written. Spell Focus, Greater Spell Focus and Skill Focus
# are generated per school / per skill by gen_focus.py (Danalieth's pattern), not written by the agents.
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'content/tools/out/feat-chunks'
OUT.mkdir(parents=True, exist_ok=True)
pages = json.load(open(ROOT / 'content/tools/out/feats.json'))

IDS = {
    270: 'magical_aptitude', 271: 'augment_summoning', 272: 'weapon_focus', 273: 'greater_weapon_focus', 274: 'quick_draw',
    275: 'athletic', 276: 'ride_by_attack', 277: 'spring_attack', 278: 'weapon_finesse', 279: 'power_attack',
    280: 'whirlwind_attack', 281: 'combat_reflexes', 282: 'self_sufficient', 283: 'spirited_charge',
    284: 'two_weapon_fighting', 285: 'blind_fight', 286: 'mounted_combat', 287: 'stunning_fist', 288: 'run',
    289: 'two_weapon_defense', 290: 'stealthy', 291: 'eschew_materials', 292: 'deft_hands', 293: 'diehard',
    294: None, 295: None, 296: 'spell_penetration', 297: 'greater_spell_penetration', 298: 'extra_turning',
    299: 'cleave', 300: 'endurance', 301: 'dodge', 302: 'combat_expertise', 303: 'manyshot', 304: 'investigator',
    305: 'deceitful', 306: 'animal_affinity', 307: 'agile', 308: 'natural_spell', 309: 'snatch_arrows',
    310: 'combat_casting', 311: 'spell_mastery', 312: 'greater_two_weapon_fighting', 313: 'martial_weapon_proficiency',
    314: 'exotic_weapon_proficiency', 315: 'simple_weapon_proficiency', 316: 'shield_proficiency',
    317: 'tower_shield_proficiency', 318: 'diligent', 319: 'negotiator', 320: 'deflect_arrows', 321: 'persuasive',
    322: 'trample', 323: 'track', 324: 'armor_proficiency_medium', 325: 'armor_proficiency_light',
    326: 'armor_proficiency_heavy', 327: 'leadership', 328: 'rapid_reload', 329: 'lightning_reflexes', 330: 'toughness',
    331: 'nimble_fingers', 332: 'improved_sunder', 333: 'improved_initiative', 334: 'improved_bull_rush',
    335: 'improved_feint', 336: 'improved_grapple', 337: 'improved_two_weapon_fighting', 338: 'improved_unarmed_strike',
    339: 'improved_counterspell', 340: 'improved_shield_bash', 341: 'improved_critical', 342: 'improved_trip',
    343: 'improved_disarm', 344: 'improved_overrun', 345: 'improved_turning', 346: 'improved_precise_shot',
    347: 'mobility', 348: 'weapon_specialization', 349: 'greater_weapon_specialization', 350: 'great_cleave', 351: None,
    352: 'point_blank_shot', 353: 'far_shot', 354: 'precise_shot', 355: 'shot_on_the_run', 356: 'mounted_archery',
    357: 'rapid_shot', 358: 'alertness', 359: 'great_fortitude', 360: 'iron_will', 361: 'acrobatic',
    363: 'heighten_spell', 364: 'empower_spell', 365: 'extend_spell', 366: 'enlarge_spell', 367: 'widen_spell',
    368: 'quicken_spell', 369: 'silent_spell', 370: 'still_spell', 371: 'maximize_spell',
    373: 'forge_ring', 374: 'craft_magic_arms_and_armor', 375: 'craft_wondrous_item', 376: 'craft_wand',
    377: 'craft_staff', 378: 'craft_rod', 379: 'scribe_scroll', 380: 'brew_potion',
    382: 'improved_natural_attack', 383: 'improved_natural_armor', 384: 'flyby_attack', 385: 'ability_focus',
    386: 'multiattack', 387: 'snatch', 388: 'multiweapon_fighting', 389: 'awesome_blow', 390: 'craft_construct',
    391: 'empower_spell_like_ability', 392: 'quicken_spell_like_ability', 393: 'wingover', 394: 'hover',
    396: 'great_smiting', 397: 'spell_knowledge', 398: 'overwhelming_critical', 399: 'lasting_inspiration',
    400: 'terrifying_rage', 401: 'planar_turning', 402: 'improved_sneak_attack', 403: 'improved_spell_capacity',
    404: 'improved_favored_enemy', 405: 'improved_elemental_wild_shape', 406: 'improved_metamagic',
    407: 'improved_stunning_fist', 408: 'familiar_spell',
}
GENERATED = {294: 'feat.spell_focus_<school>', 295: 'feat.greater_spell_focus_<school>', 351: 'feat.skill_focus_<skill>'}
CATEGORY = lambda n: 'general' if n < 362 else 'metamagic' if n < 372 else 'item_creation' if n < 381 else 'monster' if n < 395 else 'epic'

danalieth = {e['id']: e for e in json.load(open(ROOT / 'test-references/danalieth/catalog.json'))['entities'] if e['type'] == 'feat'}


def clean(t):
    return re.sub(r'\s*<a href="?$', '', t).strip()


feats = []
for p in pages:
    n = int(re.search(r'page(\d+)', p['url']).group(1))
    if n not in IDS:
        continue
    if IDS[n] is None:
        continue
    fid = 'feat.' + IDS[n]
    feats.append({'id': fid, 'category': CATEGORY(n), 'title': p['title'], 'text': '\n'.join(clean(i) for i in p['items']),
                  'existing': danalieth.get(fid)})

ids = {f['title']: f['id'] for f in feats}
ids.update({'Ecole renforcée': GENERATED[294], 'Ecole supérieure': GENERATED[295], 'Talent': GENERATED[351]})
(OUT / 'ids.json').write_text(json.dumps(ids, ensure_ascii=False, indent=1))
SIZE = 10
chunks = [feats[i:i + SIZE] for i in range(0, len(feats), SIZE)]
for i, chunk in enumerate(chunks, 1):
    (OUT / f'{i:02}.json').write_text(json.dumps(chunk, ensure_ascii=False, indent=1))
print(json.dumps({'feats': len(feats), 'chunks': len(chunks), 'existing': [f['id'] for f in feats if f['existing']],
                  'danalieth_not_on_site': [i for i in danalieth if i not in {f['id'] for f in feats}]}))

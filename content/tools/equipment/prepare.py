# Builds every equipment item from the scraped tables (content/tools/out/equipment.json): id, names, labels, display data
# (`item`) and the effects that hold numbers. The agents only write the French text (and the few effects of gear
# such as a climber's kit), so nothing in the tables is retyped by hand. Output: content/tools/out/equipment-chunks/.
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'content/tools/out/equipment-chunks'
OUT.mkdir(parents=True, exist_ok=True)
pages = json.load(open(ROOT / 'content/tools/out/equipment.json'))

# French table name -> (id, English name). Rows with the same name (ammunition after each bow) share one entity.
WEAPONS = {
    'Attaque à mains nues': ('unarmed_strike', 'Unarmed strike'), 'Gantelet': ('gauntlet', 'Gauntlet'),
    'Dague': ('dagger', 'Dagger'), 'Dague coup-de-poing': ('punching_dagger', 'Punching dagger'),
    'Gantelet clouté': ('spiked_gauntlet', 'Spiked gauntlet'), 'Masse d’armes légère': ('light_mace', 'Light mace'),
    'Serpe': ('sickle', 'Sickle'), 'Épieu': ('shortspear', 'Shortspear'), 'Gourdin': ('club', 'Club'),
    'Masse d’armes lourde': ('heavy_mace', 'Heavy mace'), 'Morgenstern': ('morningstar', 'Morningstar'),
    'Bâton': ('quarterstaff', 'Quarterstaff'), 'Lance': ('spear', 'Spear'), 'Pique': ('longspear', 'Longspear'),
    'Arbalète légère': ('light_crossbow', 'Light crossbow'), 'Carreaux (10)': ('crossbow_bolts', 'Crossbow bolts (10)'),
    'Arbalète lourde': ('heavy_crossbow', 'Heavy crossbow'), 'Dard': ('dart', 'Dart'), 'Fronde': ('sling', 'Sling'),
    'Billes (10)': ('sling_bullets', 'Sling bullets (10)'), 'Javeline': ('javelin', 'Javelin'),
    'Arme à pointes': ('armor_spikes', 'Armor spikes'), 'Épée courte': ('short_sword', 'Short sword'),
    'Hache de lancer': ('throwing_axe', 'Throwing axe'), 'Hachette': ('handaxe', 'Handaxe'), 'Kukri': ('kukri', 'Kukri'),
    'Marteau léger': ('light_hammer', 'Light hammer'), 'Matraque': ('sap', 'Sap'),
    'Pic de guerre léger': ('light_pick', 'Light pick'), 'Rondache': None, 'Rondache à pointes': None,
    'Cimeterre': ('scimitar', 'Scimitar'), 'Écu': None, 'Écu à pointes': None, 'Épée longue': ('longsword', 'Longsword'),
    'Fléau d’armes léger': ('light_flail', 'Light flail'), 'Hache d’armes': ('battleaxe', 'Battleaxe'),
    'Marteau de guerre': ('warhammer', 'Warhammer'), 'Pic de guerre lourd': ('heavy_pick', 'Heavy pick'),
    'Rapière': ('rapier', 'Rapier'), 'Trident': ('trident', 'Trident'),
    'Cimeterre à deux mains': ('falchion', 'Falchion'), 'Corsèque': ('ranseur', 'Ranseur'), 'Coutille': ('glaive', 'Glaive'),
    'Épée à deux mains': ('greatsword', 'Greatsword'), 'Faux': ('scythe', 'Scythe'),
    'Fléau d’armes lourd': ('heavy_flail', 'Heavy flail'), 'Grande hache': ('greataxe', 'Greataxe'),
    'Guisarme': ('guisarme', 'Guisarme'), 'Hallebarde': ('halberd', 'Halberd'), 'Lance d’arçon': ('lance', 'Lance'),
    'Massue': ('greatclub', 'Greatclub'), 'Arc court': ('shortbow', 'Shortbow'), 'Flèches (20)': ('arrows', 'Arrows (20)'),
    'Arc court composite': ('composite_shortbow', 'Composite shortbow'), 'Arc long': ('longbow', 'Longbow'),
    'Arc long composite': ('composite_longbow', 'Composite longbow'),
    'Kama': ('kama', 'Kama'), 'Nunchaku': ('nunchaku', 'Nunchaku'), 'Sai': ('sai', 'Sai'), 'Siangham': ('siangham', 'Siangham'),
    'Épée bâtarde': ('bastard_sword', 'Bastard sword'), 'Fouet': ('whip', 'Whip'),
    'Hache de guerre naine': ('dwarven_waraxe', 'Dwarven waraxe'), 'Chaîne cloutée': ('spiked_chain', 'Spiked chain'),
    'Double-lame': ('two_bladed_sword', 'Two-bladed sword'), 'Fléau double': ('dire_flail', 'Dire flail'),
    'Hache double orque': ('orc_double_axe', 'Orc double axe'), 'Marteau-piolet gnome': ('gnome_hooked_hammer', 'Gnome hooked hammer'),
    'Urgrosh nain': ('dwarven_urgrosh', 'Dwarven urgrosh'), 'Arbalète de poing': ('hand_crossbow', 'Hand crossbow'),
    'Arbalète légère à répétition': ('repeating_light_crossbow', 'Repeating light crossbow'),
    'Carreaux (5)': ('repeating_crossbow_bolts', 'Repeating crossbow bolts (5)'),
    'Arbalète lourde à répétition': ('repeating_heavy_crossbow', 'Repeating heavy crossbow'),
    'Bolas': ('bolas', 'Bolas'), 'Filet': ('net', 'Net'), 'Shuriken (5)': ('shuriken', 'Shuriken (5)'),
}
# Shield bash rows: their damage goes on the shield (or the shield spikes), not on an entity of their own.
BASH = {'Rondache': ['light_wooden_shield', 'light_steel_shield'], 'Écu': ['heavy_wooden_shield', 'heavy_steel_shield'],
        'Rondache à pointes': ['shield_spikes'], 'Écu à pointes': []}
ARMOR = {
    'Armure matelassée': ('padded', 'Padded armor'), 'Armure de cuir': ('leather', 'Leather armor'),
    'Armure de cuir cloutée': ('studded_leather', 'Studded leather armor'), 'Chemise de mailles': ('chain_shirt', 'Chain shirt'),
    'Armure de peau': ('hide', 'Hide armor'), 'Armure d’écailles': ('scale_mail', 'Scale mail'),
    'Cotte de mailles': ('chainmail', 'Chainmail'), 'Cuirasse': ('breastplate', 'Breastplate'),
    'Clibanion': ('splint_mail', 'Splint mail'), 'Crevice': ('banded_mail', 'Banded mail'),
    'Armure à plaques': ('half_plate', 'Half-plate'), 'Harnois': ('full_plate', 'Full plate'),
    'Targe': ('buckler', 'Buckler'), 'Rondache en bois': ('light_wooden_shield', 'Light wooden shield'),
    'Rondache en acier': ('light_steel_shield', 'Light steel shield'), 'Écu en bois': ('heavy_wooden_shield', 'Heavy wooden shield'),
    'Écu en acier': ('heavy_steel_shield', 'Heavy steel shield'), 'Pavois': ('tower_shield', 'Tower shield'),
    'Pointes pour armure': ('armor_spikes', 'Armor spikes'), 'Gantelet d’armes': ('locked_gauntlet', 'Locked gauntlet'),
    'Pointes pour bouclier': ('shield_spikes', 'Shield spikes'),
}
GOODS = {
    # Adventuring gear (page 412)
    'Aiguille à coudre': ('sewing_needle', 'Sewing needle'), 'Bélier portable': ('portable_ram', 'Portable ram'),
    'Bois de chauffage (pour un jour)': ('firewood', 'Firewood (per day)'), 'Bougie': ('candle', 'Candle'),
    'Bouteille de vin en verre': ('glass_wine_bottle', 'Glass wine bottle'),
    'Cadenas/Très simple': ('lock_very_simple', 'Lock, very simple'), 'Cadenas/Moyen': ('lock_average', 'Lock, average'),
    'Cadenas/Bon': ('lock_good', 'Lock, good'), 'Cadenas/Excellent': ('lock_amazing', 'Lock, amazing'),
    'Chaîne, 3 m': ('chain', 'Chain (10 ft.)'), 'Chausse-trappes': ('caltrops', 'Caltrops'), 'Chevalière': ('signet_ring', 'Signet ring'),
    'Chope en terre cuite': ('clay_mug', 'Mug/tankard, clay'), 'Cire à cacheter': ('sealing_wax', 'Sealing wax'),
    'Cloche': ('bell', 'Bell'), 'Coffre, vide': ('chest', 'Chest (empty)'), 'Corde en chanvre, 15 m': ('hempen_rope', 'Hempen rope (50 ft.)'),
    'Corde en soie, 15 m': ('silk_rope', 'Silk rope (50 ft.)'), 'Couverture d’hiver': ('winter_blanket', 'Winter blanket'),
    'Craie, morceau': ('chalk', 'Chalk, 1 piece'), 'Cruche en terre cuite': ('clay_pitcher', 'Pitcher, clay'),
    'Échelle, 3 m': ('ladder', 'Ladder (10 ft.)'), 'Encre, la fiole': ('ink', 'Ink (1 oz. vial)'),
    'Étui à carte ou à parchemin': ('map_case', 'Map or scroll case'), 'Filet de pêche, 2,5 m': ('fishing_net', 'Fishing net (25 sq. ft.)'),
    'Fiole pour encre ou potion': ('vial', 'Vial, ink or potion'), 'Flasque (vide)': ('flask', 'Flask (empty)'),
    'Grappin': ('grappling_hook', 'Grappling hook'), 'Hameçon': ('fishhook', 'Fishhook'), 'Huile, la flasque': ('oil', 'Oil (1-pint flask)'),
    'Jarre en terre cuite': ('clay_jug', 'Jug, clay'), 'Lampe': ('lamp', 'Lamp, common'),
    'Lanterne à capote': ('hooded_lantern', 'Lantern, hooded'), 'Lanterne sourde': ('bullseye_lantern', 'Lantern, bullseye'),
    'Longue-vue': ('spyglass', 'Spyglass'), 'Marteau': ('hammer', 'Hammer'), 'Masse': ('sledge', 'Sledge'),
    'Menottes': ('manacles', 'Manacles'), 'Menottes de qualité supérieure': ('masterwork_manacles', 'Manacles, masterwork'),
    'Outre': ('waterskin', 'Waterskin'), 'Paillasse': ('bedroll', 'Bedroll'), 'Palan': ('block_and_tackle', 'Block and tackle'),
    'Panier (vide)': ('basket', 'Basket (empty)'), 'Papier, la feuille': ('paper', 'Paper (sheet)'),
    'Parchemin, la feuille': ('parchment', 'Parchment (sheet)'), 'Pelle': ('shovel', 'Shovel or spade'),
    'Perche, 3 m': ('pole', 'Pole (10 ft.)'), 'Petit miroir en acier': ('steel_mirror', 'Mirror, small steel'),
    'Pied-de-biche': ('crowbar', 'Crowbar'), 'Pierre à aiguiser': ('whetstone', 'Whetstone'),
    'Pioche de mineur': ('miners_pick', 'Pick, miner’s'), 'Piton': ('piton', 'Piton'), 'Plume d’écriture': ('inkpen', 'Inkpen'),
    'Pot en fer': ('iron_pot', 'Pot, iron'), 'Rations de survie (par jour)': ('trail_rations', 'Trail rations (per day)'),
    'Sac (vide)': ('sack', 'Sack (empty)'), 'Sac à dos (vide)': ('backpack', 'Backpack (empty)'),
    'Sacoche de ceinture': ('belt_pouch', 'Belt pouch (empty)'), 'Savon, 1 livre': ('soap', 'Soap (per lb.)'),
    'Seau (vide)': ('bucket', 'Bucket (empty)'), 'Sifflet': ('signal_whistle', 'Whistle, signal'),
    'Silex et amorce': ('flint_and_steel', 'Flint and steel'), 'Tente': ('tent', 'Tent'), 'Toile (le m2)': ('canvas', 'Canvas (sq. yd.)'),
    'Tonneau (vide)': ('barrel', 'Barrel (empty)'), 'Torche': ('torch', 'Torch'),
    # Special substances and items (page 413)
    'Acide (flasque)': ('acid', 'Acid (flask)'), 'Allume-feu': ('tindertwig', 'Tindertwig'), 'Antidote (fiole)': ('antitoxin', 'Antitoxin (vial)'),
    'Bâton éclairant': ('sunrod', 'Sunrod'), 'Bâton fumigène': ('smokestick', 'Smokestick'), 'Eau bénite (flasque)': ('holy_water', 'Holy water (flask)'),
    'Feu grégeois (flasque)': ('alchemists_fire', 'Alchemist’s fire (flask)'), 'Pierre à tonnerre': ('thunderstone', 'Thunderstone'),
    'Sacoche immobilisante': ('tanglefoot_bag', 'Tanglefoot bag'), 'Torche éternelle': ('everburning_torch', 'Everburning torch'),
    # Class tools and skill kits (page 414)
    'Balance': ('merchants_scale', 'Merchant’s scale'), 'Clepsydre': ('water_clock', 'Water clock'),
    'Houx et gui': ('holly_and_mistletoe', 'Holly and mistletoe'), 'Instrument de musique courant': ('musical_instrument', 'Musical instrument, common'),
    'Instrument de musique de maître': ('masterwork_musical_instrument', 'Musical instrument, masterwork'),
    'Grimoire (vierge)': ('spellbook', 'Spellbook, wizard’s (blank)'), 'Laboratoire d’alchimie': ('alchemists_lab', 'Alchemist’s lab'),
    'Loupe': ('magnifying_glass', 'Magnifying glass'), 'Matériel d’escalade': ('climbers_kit', 'Climber’s kit'),
    'Outils d’artisan': ('artisans_tools', 'Artisan’s tools'), 'Outils de maître artisan': ('masterwork_artisans_tools', 'Artisan’s tools, masterwork'),
    'Outils de cambrioleur': ('thieves_tools', 'Thieves’ tools'), 'Outils de cambrioleur de qualité supérieure': ('masterwork_thieves_tools', 'Thieves’ tools, masterwork'),
    'Outil de qualité supérieure': ('masterwork_tool', 'Tool, masterwork'), 'Sablier': ('hourglass', 'Hourglass'),
    'Sacoche à composantes': ('spell_component_pouch', 'Spell component pouch'), 'Symbole sacré en argent': ('silver_holy_symbol', 'Holy symbol, silver'),
    'Symbole sacré en bois': ('wooden_holy_symbol', 'Holy symbol, wooden'), 'Trousse de déguisement': ('disguise_kit', 'Disguise kit'),
    'Trousse de premiers secours': ('healers_kit', 'Healer’s kit'),
    # Clothing (page 415)
    'Costume d’artiste': ('entertainers_outfit', 'Entertainer’s outfit'), 'Habit d’érudit': ('scholars_outfit', 'Scholar’s outfit'),
    'Habit de cour': ('courtiers_outfit', 'Courtier’s outfit'), 'Habit de moine': ('monks_outfit', 'Monk’s outfit'),
    'Habit de noble': ('nobles_outfit', 'Noble’s outfit'), 'Habit de paysan': ('peasants_outfit', 'Peasant’s outfit'),
    'Tenue d’artisan': ('artisans_outfit', 'Artisan’s outfit'), 'Tenue d’explorateur': ('explorers_outfit', 'Explorer’s outfit'),
    'Tenue de voyage': ('travelers_outfit', 'Traveler’s outfit'), 'Tenue polaire': ('cold_weather_outfit', 'Cold weather outfit'),
    'Tenue sacerdotale': ('clerics_vestments', 'Cleric’s vestments'), 'Toilette royale': ('royal_outfit', 'Royal outfit'),
    # Food, drink and lodging (page 416)
    'Banquet (par convive)': ('banquet', 'Banquet (per person)'), 'Bière/La chope': ('ale_mug', 'Ale, mug'),
    'Bière/Le litre': ('ale_gallon', 'Ale, gallon'), 'Fromage, la portion': ('cheese', 'Cheese, hunk of'),
    'Pain, la miche': ('bread', 'Bread, per loaf'), 'Repas (par jour)/Qualité médiocre': ('meals_poor', 'Meals (per day), poor'),
    'Repas (par jour)/Qualité convenable': ('meals_common', 'Meals (per day), common'), 'Repas (par jour)/Bonne qualité': ('meals_good', 'Meals (per day), good'),
    'Séjour à l’auberge (par jour)/Qualité médiocre': ('inn_poor', 'Inn stay (per day), poor'),
    'Séjour à l’auberge (par jour)/Qualité convenable': ('inn_common', 'Inn stay (per day), common'),
    'Séjour à l’auberge (par jour)/Bonne qualité': ('inn_good', 'Inn stay (per day), good'),
    'Vin/De table (le pichet)': ('wine_common', 'Wine, common (pitcher)'), 'Vin/Bon cru (la bouteille)': ('wine_fine', 'Wine, fine (bottle)'),
    # Mounts and related gear (page 417)
    'Âne ou mulet': ('donkey_or_mule', 'Donkey or mule'), 'Barde/Créature de taille moyenne': ('barding_medium', 'Barding, Medium creature'),
    'Barde/Créature de grande taille': ('barding_large', 'Barding, Large creature'), 'Cheval/Destrier léger': ('light_warhorse', 'Warhorse, light'),
    'Cheval/Destrier lourd': ('heavy_warhorse', 'Warhorse, heavy'), 'Cheval/Cheval léger': ('light_horse', 'Horse, light'),
    'Cheval/Cheval lourd': ('heavy_horse', 'Horse, heavy'), 'Cheval/Poney': ('pony', 'Pony'), 'Cheval/Poney de guerre': ('warpony', 'Warpony'),
    'Chien de garde': ('guard_dog', 'Dog, guard'), 'Chien de selle': ('riding_dog', 'Dog, riding'), 'Écurie (pour une journée)': ('stabling', 'Stabling (per day)'),
    'Fontes': ('saddlebags', 'Saddlebags'), 'Mors et bride': ('bit_and_bridle', 'Bit and bridle'), 'Nourriture pour animaux (par jour)': ('feed', 'Feed (per day)'),
    'Selle/D’équitation': ('riding_saddle', 'Saddle, riding'), 'Selle/De bât': ('pack_saddle', 'Saddle, pack'), 'Selle/De guerre': ('military_saddle', 'Saddle, military'),
    'Selle, spéciale/D’équitation': ('exotic_riding_saddle', 'Saddle, exotic, riding'), 'Selle, spéciale/De bât': ('exotic_pack_saddle', 'Saddle, exotic, pack'),
    'Selle, spéciale/De guerre': ('exotic_military_saddle', 'Saddle, exotic, military'),
    # Transport (page 418)
    'Barque': ('rowboat', 'Rowboat'), 'Rame': ('oar', 'Oar'), 'Bateau à fond plat': ('keelboat', 'Keelboat'), 'Carriole': ('carriage', 'Carriage'),
    'Chariot': ('wagon', 'Wagon'), 'Charrette': ('cart', 'Cart'), 'Drakkar': ('longship', 'Longship'), 'Navire de haute mer': ('sailing_ship', 'Sailing ship'),
    'Traîneau': ('sled', 'Sled'), 'Trirème': ('galley', 'Galley'), 'Vaisseau de guerre': ('warship', 'Warship'),
    # Services (page 419); the ten spellcasting rows become one entity
    'Diligence': ('coach_cab', 'Coach cab'), 'Droit de passage ou d’entrée': ('road_or_gate_toll', 'Road or gate toll'),
    'Employé qualifié': ('hireling_trained', 'Hireling, trained'), 'Employé non qualifié': ('hireling_untrained', 'Hireling, untrained'),
    'Messager': ('messenger', 'Messenger'), 'Sorts': ('spellcasting_service', 'Spellcasting'), 'Traversée en bateau': ('ships_passage', 'Ship’s passage'),
}
GROUP = {412: 'gear', 413: 'special_substance', 414: 'tool', 415: 'clothing', 416: 'food', 417: 'mount', 418: 'vehicle', 419: 'service'}
# Body slot (informative, Character model): what the item takes when worn or wielded.
SLOT = {'gear': None, 'special_substance': None, 'tool': None, 'clothing': 'body', 'food': None, 'mount': None, 'vehicle': None, 'service': None}
MOUNT_GEAR = {'saddlebags', 'bit_and_bridle', 'feed', 'riding_saddle', 'pack_saddle', 'military_saddle', 'exotic_riding_saddle',
              'exotic_pack_saddle', 'exotic_military_saddle', 'stabling', 'barding_medium', 'barding_large'}
MONK = {'kama', 'nunchaku', 'quarterstaff', 'sai', 'shuriken', 'siangham', 'unarmed_strike'}
DIES = {'2', '3', '4', '6', '8', '10', '12'}


def strip_note(name):
    """Footnote marks are digits glued to the name (`Pique4`)."""
    return re.sub(r'(?<=[a-zé])\d$', '', name.strip())


def dice(cell):
    """`1d23` is 1d2 with footnote 3 (nonlethal); `1d12` is a real d12. Returns (dice, footnote)."""
    cell = cell.strip()
    if cell in ('', '—', '-'):
        return None, None
    out, notes = [], set()
    for part in cell.split('/'):
        m = re.fullmatch(r'(\d+)(?:d(\d+))?', part)
        if not m:
            raise ValueError(cell)
        count, size = m.group(1), m.group(2)
        if size and size not in DIES and size[:-1] in DIES:
            notes.add(size[-1]); size = size[:-1]
        out.append(f'{count}d{size}' if size else count)
    return '/'.join(out), notes


def critical(cell):
    """`19–20/´2` -> ('19–20/×2', width 2, multiplier 2). The site renders × as ´."""
    cell = cell.replace('´', '×').strip()
    if cell in ('', '—'):
        return None, None, None
    m = re.match(r'(?:(\d+)–20/)?×(\d)', cell)
    low = int(m.group(1)) if m.group(1) else 20
    return cell, 21 - low, int(m.group(2))


def item_effect(target, value, **kw):
    return {'target': target, 'op': kw.pop('op', 'set'), 'value': value, **kw}


items = {}


def put(_, entity):
    id_ = entity['id']
    if id_ in items:
        items[id_]['item'].update({k: v for k, v in entity['item'].items() if k not in items[id_]['item']})
        items[id_]['labels'] += [l for l in entity['labels'] if l not in items[id_]['labels']]
        items[id_]['effects'] += entity.get('effects', [])
        items[id_]['_rows'] += entity['_rows']
    else:
        items[id_] = entity


# Weapons (page 410): tables 1..3 are simple, martial and exotic weapons; header rows name the use.
USE = {'Combat à mains nues': 'unarmed', 'Armes de corps à corps légères': 'light', 'Armes de corps à corps à une main': 'one_handed',
       'Armes de corps à corps à deux mains': 'two_handed', 'Armes à distance': 'ranged'}
PROF = ['simple', 'martial', 'exotic']
weapon_page = pages[0]
bash = {}
for prof, table in zip(PROF, weapon_page['tables'][1:4]):
    use = None
    for row in table[1:]:
        if all(c == '' for c in row[1:]):
            use = USE[row[0]]
            continue
        raw = row[0]
        name = strip_note(raw)
        note = raw[len(name):]
        small, n1 = dice(row[2])
        medium, n2 = dice(row[3])
        crit_text, width, mult = critical(row[4])
        info = {'slot': 'weapon', 'cost': row[1] if row[1] not in ('', '—') else None, 'weight': row[6] if row[6] not in ('', '—') else None,
                'damage': medium, 'damageSmall': small, 'critical': crit_text,
                'range': row[5] if row[5] not in ('', '—') else None, 'damageType': row[7] if row[7] not in ('', '—') else None}
        info = {k: v for k, v in info.items() if v}
        if name in BASH:
            bash[name] = (info, prof, use)
            continue
        id_, en = WEAPONS[name]
        ammo = name.startswith(('Carreaux', 'Flèches', 'Billes'))
        labels = ['item', 'ammunition'] if ammo else ['item', 'weapon', prof, use]
        # The site marks the halberd as a reach weapon; in the SRD it is not.
        if note == '4' and id_ != 'halberd': labels.append('reach')
        if note == '5': labels.append('double')
        if '3' in (n1 or set()) | (n2 or set()): labels.append('nonlethal')
        if id_ in MONK: labels.append('monk')
        if use != 'ranged' and info.get('range'): labels.append('thrown')
        effects = []
        if medium and not ammo:
            first = medium.split('/')[0]
            effects.append(item_effect('weapon.damage', first, layer='base', scope='item'))
            effects.append(item_effect('weapon.threat_range', width, layer='base', scope='item'))
            effects.append(item_effect('weapon.crit_multiplier', mult, layer='base', scope='item'))
            # Two-handed melee: Strength ×1.5 on damage, as on Danalieth's greatsword (a penalty is multiplied too).
            if use == 'two_handed':
                effects.append({'target': 'damage.melee.ability', 'op': 'multiply', 'value': 1.5, 'multMode': 'additive'})
        if ammo:
            info.pop('slot')
        put(id_, {'id': 'item.' + id_, 'type': 'item', 'name': {'fr': name, 'en': en}, 'provenance': 'official', 'labels': labels,
                  'item': info, 'effects': effects, '_rows': [' | '.join(row)], '_page': 410})

# Armor and shields (page 411).
KIND = {'Armure légère': 'light_armor', 'Armures intermédiaires': 'medium_armor', 'Armures lourdes': 'heavy_armor',
        'Boucliers': 'shield', 'Suppléments': 'extra'}
kind = None
for row in pages[1]['tables'][1][1:]:
    if all(c == '' for c in row[1:]):
        kind = KIND[row[0]]
        continue
    name = strip_note(row[0])
    id_, en = ARMOR[name]
    num = lambda c: int(re.sub(r'[^\d]', '', c.replace('–', '-')) or 0) * (-1 if c.strip().startswith(('–', '-')) else 1)
    bonus = re.sub(r'(\+\d)\d$', r'\1', row[2])  # `+43`: +4 with footnote 3
    speed = None if row[6] in ('', '—') else f"{strip_note(row[6])} / {strip_note(row[7])}"
    info = {'slot': 'shield' if kind == 'shield' else 'armor', 'cost': row[1], 'weight': row[8], 'armorBonus': bonus if bonus != '—' else None,
            'maxDex': row[3] if row[3] != '—' else None, 'checkPenalty': row[4] if row[4] not in ('—',) else None,
            'spellFailure': row[5] if row[5] not in ('—', '4') else None, 'speed': speed if kind in ('medium_armor', 'heavy_armor') else None}
    info = {k: v for k, v in info.items() if v}
    effects = []
    if kind != 'extra':
        effects.append(item_effect('ac.shield' if kind == 'shield' else 'ac.armor', num(bonus), layer='base'))
        if row[3] != '—':
            effects.append(item_effect('ac.dex_bonus', num(row[3]), op='max'))
        if num(row[4]):
            effects.append(item_effect('armor.check_penalty', num(row[4]), op='add'))
        if num(row[5]):
            effects.append(item_effect('spell_failure.arcane', num(row[5]), op='add'))
    labels = ['item', 'armor', kind] if kind not in ('shield', 'extra') else ['item', kind] if kind == 'shield' else ['item', 'armor_extra']
    if kind == 'extra':
        info.pop('slot')
    put(id_, {'id': 'item.' + id_, 'type': 'item', 'name': {'fr': name, 'en': en}, 'provenance': 'official', 'labels': labels,
              'item': info, 'effects': effects, '_rows': [' | '.join(row)], '_page': 411})
    if id_ == 'tower_shield':
        items['item.tower_shield']['effects'].append(item_effect('weapon.attack', -2, op='add', scope='item'))

for name, (info, prof, use) in bash.items():
    for id_ in BASH[name]:
        e = items['item.' + id_]
        for k in ('damage', 'damageSmall', 'critical', 'damageType'):
            e['item'].setdefault(k, info.get(k))
        e['_rows'].append(f'coup de bouclier ({name}): ' + json.dumps(info, ensure_ascii=False))
# Armor spikes are a weapon row and an armor add-on: the add-on's name, price and weight win.
spikes = items['item.armor_spikes']
spikes['name']['fr'] = 'Pointes pour armure'
spikes['item'].update(cost='+50 po', weight='+5 kg')
spikes['labels'] = list(dict.fromkeys(spikes['labels']))
# Armor spikes, gauntlets and shield spikes are worn with a main weapon: their damage is display data only, so they do
# not replace the wielded weapon's dice (one wielded weapon in the model).
for id_ in ('armor_spikes',):
    items['item.' + id_]['effects'] = [x for x in items['item.' + id_]['effects'] if x.get('scope') != 'item']

# Masterwork quality (page 410, « Les armes de maître »; page 411 for armor): items of their own, equipped alongside.
items['item.masterwork_weapon'] = {'id': 'item.masterwork_weapon', 'type': 'item', 'name': {'fr': 'Arme de maître', 'en': 'Masterwork weapon'},
    'provenance': 'official', 'labels': ['item', 'masterwork', 'weapon'], 'item': {'cost': '+300 po'},
    'effects': [item_effect('weapon.attack', 1, op='add', bonusType='enhancement', scope='item')], '_rows': ['generated'], '_page': 410}
items['item.masterwork_armor'] = {'id': 'item.masterwork_armor', 'type': 'item', 'name': {'fr': 'Armure de maître', 'en': 'Masterwork armor'},
    'provenance': 'official', 'labels': ['item', 'masterwork', 'armor'], 'item': {'cost': '+150 po'},
    'effects': [item_effect('armor.check_penalty', 1, op='add'), item_effect('armor.check_penalty', 0, op='max')], '_rows': ['generated'], '_page': 411}

# Goods (pages 412-419): one table each; a row with empty price is a group heading for the rows under it.
for page in pages[2:]:
    n = int(re.search(r'page(\d+)', page['url']).group(1))
    group = GROUP[n]
    table = page['tables'][-1] if n != 417 else page['tables'][0]
    heading = None
    for row in table:
        cells = row[1:] if row and row[0] == '' else row
        if len(cells) < 2 or cells[0] in ('', 'Article', 'Service'):
            continue
        name, price = strip_note(cells[0].replace('‡', '')).strip(), cells[1].replace('´', '×').strip()
        weight = cells[2].replace('´', '×').strip() if len(cells) > 2 else ''
        if name == '3 pa':  # a row the site lost its name: SRD "Meat, chunk of"
            name, price, weight = 'Viande, le morceau', '3 pa', '500 g'
            GOODS['Viande, le morceau'] = ('meat', 'Meat, chunk of')
        if not price:
            heading = name
            continue
        key = f'{heading}/{name}' if heading and f'{heading}/{name}' in GOODS else name
        if name.startswith('Sorts'):
            key = 'Sorts'
        if key not in GOODS:
            heading = None
            key = name
        id_, en = GOODS[key]
        weight = re.sub(r'(kg|g)[1†]$', r'\1', weight)
        price = re.sub(r'po2$', 'po', price)
        info = {k: v for k, v in {'slot': SLOT[group], 'cost': price if price != '—' else None, 'weight': weight if weight not in ('—', '') else None}.items() if v}
        labels = ['item', 'mount_gear' if id_ in MOUNT_GEAR else group]
        fr = key.replace('/', ', ') if '/' in key else name
        if id_ == 'spellcasting_service':
            fr = 'Lancement de sort'
            info['cost'] = 'niveau de sort × niveau de lanceur × 10 po (niveau 0 : × 5 po)'
        put(id_, {'id': 'item.' + id_, 'type': 'item', 'name': {'fr': fr, 'en': en}, 'provenance': 'official', 'labels': labels,
                  'item': info, 'effects': [], '_rows': [' | '.join(cells)], '_page': n})

missing = sorted({v[0] for v in [*WEAPONS.values(), *ARMOR.values(), *GOODS.values()] if v} - {e[5:] for e in items})
assert not missing, missing

# The weapons first written in rules.json (now moved here) kept their ids; their short descriptions were a starting point
# for the agents.
existing = {e['id']: e for e in json.load(open(ROOT / 'content/srd/rules.json'))['entities'] if e['id'].startswith('item.')}
assert set(existing) <= set(items), set(existing) - set(items)

text = {int(re.search(r'page(\d+)', p['url']).group(1)): '\n'.join(p['items']) for p in pages}
chunks = []
order = sorted(items.values(), key=lambda e: (e['_page'], e['id']))
for page in sorted({e['_page'] for e in order}):
    group = [e for e in order if e['_page'] == page]
    size = -(-len(group) // -(-len(group) // 20))
    for i in range(0, len(group), size):
        chunks.append({'page': page, 'items': group[i:i + size]})
for i, chunk in enumerate(chunks, 1):
    entities = []
    for e in chunk['items']:
        skeleton = {k: v for k, v in e.items() if not k.startswith('_')}
        if not skeleton['effects']:
            skeleton.pop('effects')
        entities.append({'skeleton': skeleton, 'table_rows': e['_rows'], 'existing': existing.get(e['id'])})
    (OUT / f'{i:02}.json').write_text(json.dumps({'page': chunk['page'], 'page_text': text[chunk['page']] + ('\n' + text[411] if chunk['page'] == 410 else ''),
                                                  'items': entities}, ensure_ascii=False, indent=1))
(OUT / 'ids.json').write_text(json.dumps(sorted(items), indent=1))
print(json.dumps({'items': len(items), 'chunks': len(chunks), 'per_page': {p: sum(1 for e in order if e['_page'] == p) for p in sorted({e['_page'] for e in order})}}))

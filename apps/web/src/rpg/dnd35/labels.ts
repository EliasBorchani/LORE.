import { LABEL_ICONS, type IconDrawing } from './icons'

/** A label's colour: one per family, from the theme tokens. */
export type LabelColour = 'garnet' | 'focus' | 'seal' | 'gilt' | 'muted'

export interface Label {
  id: string
  fr: string
  en: string
  colour: LabelColour
  /** The entry types that offer it in the editor. */
  types: string[]
  icon: IconDrawing
}

type Row = [id: string, fr: string, en: string]

function family(colour: LabelColour, types: string[], rows: Row[]): Label[] {
  return rows.map(([id, fr, en]) => ({ id, fr, en, colour, types, icon: LABEL_ICONS[id] }))
}

export const LABELS: Label[] = [
  ...family('seal', ['creature'], [['animal', 'Animal', 'Animal'], ['plant', 'Plante', 'Plant']]),
  ...family('muted', ['feat'], [
    ['general', 'Général', 'General'], ['skill', 'Compétence', 'Skill'], ['epic', 'Épique', 'Epic'],
    ['monster', 'Monstre', 'Monster'], ['story', 'Histoire', 'Story'], ['custom', 'Maison', 'House'],
    ['tactical', 'Tactique', 'Tactical'], ['psionic', 'Psionique', 'Psionic'], ['draconic', 'Draconique', 'Draconic'],
    ['wild', 'Forme animale', 'Wild'], ['bardic_music', 'Musique de barde', 'Bardic music'], ['weapon_style', 'Style d’arme', 'Weapon style'],
  ]),
  ...family('garnet', ['feat'], [
    ['fighter_bonus', 'Bonus de guerrier', 'Fighter bonus'], ['warblade_bonus', 'Bonus de maître des lames', 'Warblade bonus'], ['scout_bonus', 'Bonus d’éclaireur', 'Scout bonus'], ['hexblade_bonus', 'Bonus de tourmenteur', 'Hexblade bonus'], ['melee', 'Corps à corps', 'Melee'], ['ranged', 'Distance', 'Ranged'],
    ['defense', 'Défense', 'Defense'], ['proficiency', 'Maniement', 'Proficiency'], ['movement', 'Déplacement', 'Movement'],
    ['unarmed', 'Mains nues', 'Unarmed'], ['mounted', 'Monté', 'Mounted'], ['two_weapon', 'Deux armes', 'Two-weapon'],
    ['natural_attack', 'Attaque naturelle', 'Natural attack'], ['flight', 'Vol', 'Flight'],
  ]),
  ...family('focus', ['feat'], [
    ['magic', 'Magie', 'Magic'], ['wizard_bonus', 'Bonus de magicien', 'Wizard bonus'], ['dc', 'DD des sorts', 'Spell DC'],
    ['metamagic', 'Métamagie', 'Metamagic'], ['item_creation', 'Création d’objets', 'Item creation'],
    ['turning', 'Renvoi des morts-vivants', 'Turning'], ['slots', 'Emplacements de sorts', 'Spell slots'],
    ['caster_level', 'Niveau de lanceur', 'Caster level'],
  ]),
  ...family('focus', ['spell'], [
    ['abjuration', 'Abjuration', 'Abjuration'], ['conjuration', 'Invocation', 'Conjuration'], ['divination', 'Divination', 'Divination'],
    ['enchantment', 'Enchantement', 'Enchantment'], ['evocation', 'Évocation', 'Evocation'], ['illusion', 'Illusion', 'Illusion'],
    ['necromancy', 'Nécromancie', 'Necromancy'], ['transmutation', 'Transmutation', 'Transmutation'], ['universal', 'Universel', 'Universal'],
    ['buff', 'Renforcement', 'Buff'], ['healing', 'Soins', 'Healing'], ['damage', 'Dégâts', 'Damage'], ['fire', 'Feu', 'Fire'],
    ['electricity', 'Électricité', 'Electricity'], ['rays', 'Rayon', 'Ray'], ['area', 'Zone', 'Area'], ['attack', 'Attaque', 'Attack'],
    ['strength', 'Force', 'Strength'], ['size', 'Taille', 'Size'], ['bludgeoning', 'Contondant', 'Bludgeoning'],
    ['dispel', 'Dissipation', 'Dispel'], ['summoning', 'Convocation', 'Summoning'],
  ]),
  ...family('seal', ['item'], [
    ['weapon', 'Arme', 'Weapon'], ['armor', 'Armure', 'Armor'], ['shield', 'Bouclier', 'Shield'], ['gear', 'Matériel', 'Gear'],
    ['tool', 'Outil', 'Tool'], ['consumable', 'Consommable', 'Consumable'], ['container', 'Contenant', 'Container'],
    ['food', 'Nourriture', 'Food'], ['clothing', 'Vêtement', 'Clothing'], ['cloak', 'Cape', 'Cloak'],
    ['mount_gear', 'Harnachement', 'Tack'], ['vehicle', 'Transport', 'Vehicle'], ['special_substance', 'Substance', 'Special substance'],
    ['light_source', 'Source de lumière', 'Light source'], ['mount', 'Monture', 'Mount'], ['writing', 'Écriture', 'Writing'],
    ['service', 'Service', 'Service'], ['climbing', 'Escalade', 'Climbing'], ['splash', 'Projectile à impact', 'Splash weapon'],
    ['kit', 'Trousse', 'Kit'], ['holy_symbol', 'Symbole sacré', 'Holy symbol'], ['instrument', 'Instrument', 'Instrument'],
    ['masterwork', 'De maître', 'Masterwork'], ['trinket', 'Babiole', 'Trinket'], ['trap', 'Piège', 'Trap'], ['tome', 'Tome', 'Tome'],
    ['ioun', 'Pierre ioun', 'Ioun stone'], ['ammunition', 'Munitions', 'Ammunition'], ['armor_extra', 'Accessoire d’armure', 'Armor extra'],
    ['inherent', 'Inhérent', 'Inherent'], ['critical', 'Critique', 'Critical'],
  ]),
  ...family('garnet', ['item'], [
    ['simple', 'Courante', 'Simple'], ['martial', 'De guerre', 'Martial'], ['exotic', 'Exotique', 'Exotic'], ['light', 'Légère', 'Light'],
    ['one_handed', 'À une main', 'One-handed'], ['two_handed', 'À deux mains', 'Two-handed'], ['thrown', 'De jet', 'Thrown'],
    ['reach', 'Allonge', 'Reach'], ['double', 'Double', 'Double'], ['nonlethal', 'Non létale', 'Nonlethal'],
    ['light_armor', 'Armure légère', 'Light armor'], ['medium_armor', 'Armure intermédiaire', 'Medium armor'],
    ['heavy_armor', 'Armure lourde', 'Heavy armor'],
  ]),
  ...family('gilt', ['class_power'], [
    ['barbarian', 'Barbare', 'Barbarian'], ['bard', 'Barde', 'Bard'], ['cleric', 'Prêtre', 'Cleric'], ['druid', 'Druide', 'Druid'],
    ['fighter', 'Guerrier', 'Fighter'], ['monk', 'Moine', 'Monk'], ['paladin', 'Paladin', 'Paladin'], ['ranger', 'Rôdeur', 'Ranger'],
    ['rogue', 'Roublard', 'Rogue'], ['sorcerer', 'Ensorceleur', 'Sorcerer'], ['wizard', 'Magicien', 'Wizard'],
    ['warblade', 'Maître des lames', 'Warblade'], ['swordsage', 'Sage de l’épée', 'Swordsage'], ['crusader', 'Croisé', 'Crusader'],
    ['arcane_archer', 'Archer-mage', 'Arcane archer'], ['arcane_trickster', 'Filou arcanique', 'Arcane trickster'],
    ['archmage', 'Archimage', 'Archmage'], ['assassin', 'Assassin', 'Assassin'], ['blackguard', 'Chevalier noir', 'Blackguard'],
    ['dragon_disciple', 'Disciple draconien', 'Dragon disciple'], ['duelist', 'Duelliste', 'Duelist'],
    ['dwarven_defender', 'Défenseur nain', 'Dwarven defender'], ['eldritch_knight', 'Chevalier occulte', 'Eldritch knight'],
    ['hierophant', 'Hiérophante', 'Hierophant'], ['horizon_walker', 'Arpenteur d’horizon', 'Horizon walker'],
    ['loremaster', 'Maître du savoir', 'Loremaster'], ['mystic_theurge', 'Théurge mystique', 'Mystic theurge'],
    ['shadowdancer', 'Danseur de l’ombre', 'Shadowdancer'], ['thaumaturgist', 'Thaumaturge', 'Thaumaturgist'],
    ['ultimate_magus', 'Mage ultime', 'Ultimate magus'],
    ['warmage', 'Mage de bataille', 'Warmage'], ['wu_jen', 'Wu jen', 'Wu Jen'], ['warlock', 'Sorcier', 'Warlock'], ['acolyte_of_the_skin', 'Acolyte de la peau', 'Acolyte of the Skin'], ['alienist', 'Aliéniste', 'Alienist'], ['argent_savant', 'Savant d’argent', 'Argent Savant'], ['blood_magus', 'Mage du sang', 'Blood Magus'], ['effigy_master', 'Maître des effigies', 'Effigy Master'], ['elemental_savant', 'Savant élémentaire', 'Elemental Savant'], ['enlightened_fist', 'Poing illuminé', 'Enlightened Fist'], ['fatespinner', 'Maître du destin', 'Fatespinner'], ['geometer', 'Géomètre', 'Geometer'], ['green_star_adept', 'Adepte de l’étoile verdoyante', 'Green Star Adept'], ['mage_of_the_arcane_order', 'Mage de l’ordre profane', 'Mage of the Arcane Order'], ['master_transmogrifist', 'Maître transmogriffiste', 'Master Transmogrifist'], ['mindbender', 'Maître de l’esprit', 'Mindbender'], ['seeker_of_the_song', 'Quêteur de chant', 'Seeker of the Song'], ['sevenfold_veil', 'Initié du voile septuple', 'Initiate of the Sevenfold Veil'], ['sublime_chord', 'Accord sublime', 'Sublime Chord'], ['suel_arcanamach', 'Arcanamach suellois', 'Suel Arcanamach'], ['wayfarer_guide', 'Guide-voyageur', 'Wayfarer Guide'], ['wild_mage', 'Mage sauvage', 'Wild Mage'],
    ['scout', 'Éclaireur', 'Scout'], ['ninja', 'Ninja', 'Ninja'], ['spellthief', 'Kleptomage', 'Spellthief'], ['animal_lord', 'Seigneur des animaux', 'Animal Lord'], ['beastmaster', 'Maître des bêtes', 'Beastmaster'], ['bloodhound', 'Limier professionnel', 'Bloodhound'], ['daggerspell_mage', 'Mage enchantelame', 'Daggerspell Mage'], ['daggerspell_shaper', 'Animorphe enchantelame', 'Daggerspell Shaper'], ['dread_pirate', 'Pirate flamboyant', 'Dread Pirate'], ['dungeon_delver', 'Fouilleur de donjon', 'Dungeon Delver'], ['exemplar', 'Figure exemplaire', 'Exemplar'], ['fochlucan_lyrist', 'Aède de Fochluchan', 'Fochlucan Lyrist'], ['ghost_faced_killer', 'Tueur fantôme', 'Ghost-Faced Killer'], ['gnome_artificer', 'Maître créateur', 'Gnome Artificer'], ['highland_stalker', 'Traqueur des cimes', 'Highland Stalker'], ['master_of_many_forms', 'Maître des formes multiples', 'Master of Many Forms'], ['mindspy', 'Fureteur spirituel', 'Mindspy'], ['nightsong_enforcer', 'Exécutant du Noctechant', 'Nightsong Enforcer'], ['nightsong_infiltrator', 'Silence du Noctechant', 'Nightsong Infiltrator'], ['ollam', 'Ollam', 'Ollam'], ['shadowbane_inquisitor', 'Inquisiteur fléombre', 'Shadowbane Inquisitor'], ['shadowbane_stalker', 'Traqueur fléombre', 'Shadowbane Stalker'], ['spymaster', 'Maître espion', 'Spymaster'], ['streetfighter', 'Combattant de rue', 'Streetfighter'], ['tempest', 'Tempête d’acier', 'Tempest'], ['thief_acrobat', 'Voleur-acrobate', 'Thief-Acrobat'], ['vigilante', 'Redresseur de torts', 'Vigilante'], ['virtuoso', 'Virtuose itinérant', 'Virtuoso'], ['wild_plains_outrider', 'Cavalier des steppes', 'Wild Plains Outrider'],
    ['samurai', 'Samouraï', 'Samurai'], ['swashbuckler', 'Spadassin', 'Swashbuckler'], ['hexblade', 'Tourmenteur', 'Hexblade'], ['paladin_variant', 'Paladin sans magie', 'Paladin, no spells'], ['ranger_variant', 'Rôdeur sans magie', 'Ranger, no spells'], ['bear_warrior', 'Guerrier ursidé', 'Bear Warrior'], ['bladesinger', 'Chantelame', 'Bladesinger'], ['bounty_hunter', 'Justicier solitaire', 'Bounty Hunter'], ['cavalier', 'Preux cavalier', 'Cavalier'], ['dark_hunter', 'Chasseur sombre', 'Dark Hunter'], ['darkwood_stalker', 'Traqueur du bois obscur', 'Darkwood Stalker'], ['dervish', 'Derviche flamboyant', 'Dervish'], ['drunken_master', 'Maître de l’ivresse', 'Drunken Master'], ['exotic_weapon_master', 'Maître d’armes exotiques', 'Exotic Weapon Master'], ['eye_of_gruumsh', 'Œil de Gruumsh', 'Eye of Gruumsh'], ['frenzied_berserker', 'Berserker frénétique', 'Frenzied Berserker'], ['gnome_giant_slayer', 'Gnome tueur de géants', 'Gnome Giant-Slayer'], ['halfling_outrider', 'Cavalier émérite halfelin', 'Halfling Outrider'], ['hulking_hurler', 'Lanceur massif', 'Hulking Hurler'], ['hunter_of_the_dead', 'Chasseur de morts-vivants', 'Hunter of the Dead'], ['invisible_blade', 'Lame invisible', 'Invisible Blade'], ['kensai', 'Kensaï', 'Kensai'], ['knight_of_the_chalice', 'Chevalier du Calice', 'Knight of the Chalice'], ['knight_protector', 'Chevalier protecteur', 'Knight Protector'], ['master_of_the_unseen_hand', 'Maître de la main subtile', 'Master of the Unseen Hand'], ['master_thrower', 'Lanceur virtuose', 'Master Thrower'], ['mindspy_warrior', 'Mouchard mental', 'Mindspy (Complete Warrior)'], ['natures_warrior', 'Combattant de la nature', 'Nature’s Warrior'], ['occult_slayer', 'Pourfendeur de mages', 'Occult Slayer'], ['order_of_the_bow_initiate', 'Initié de l’ordre des archers', 'Order of the Bow Initiate'], ['purple_dragon_knight', 'Chevalier Dragon pourpre', 'Purple Dragon Knight'], ['rage_mage', 'Mage-berserker', 'Rage Mage'], ['ravager', 'Ravageur implacable', 'Ravager'], ['reaping_mauler', 'Pugiliste intrépide', 'Reaping Mauler'], ['ronin', 'Ronin', 'Ronin'], ['spellsword', 'Magelame', 'Spellsword'], ['stonelord', 'Seigneur de la pierre', 'Stonelord'], ['tattooed_monk', 'Moine tatoué', 'Tattooed Monk'], ['thayan_knight', 'Chevalier Thayen', 'Thayan Knight'], ['war_chanter', 'Chantre de guerre', 'War Chanter'], ['warshaper', 'Bellimorphe', 'Warshaper'],
    ['favored_soul', 'Élu divin', 'Favored Soul'], ['shugenja', 'Shugenja', 'Shugenja'], ['spirit_shaman', 'Chaman spiritiste', 'Spirit Shaman'], ['black_flame_zealot', 'Fanatique de la Flamme noire', 'Black Flame Zealot'], ['blighter', 'Saccageur tellurique', 'Blighter'], ['church_inquisitor', 'Inquisiteur de la Foi', 'Church Inquisitor'], ['consecrated_harrier', 'Traqueur consacré', 'Consecrated Harrier'], ['contemplative', 'Maître contemplatif', 'Contemplative'], ['divine_crusader', 'Croisé divin', 'Divine Crusader'], ['divine_oracle', 'Oracle divin', 'Divine Oracle'], ['entropomancer', 'Entropomancien', 'Entropomancer'], ['evangelist', 'Évangéliste errant', 'Evangelist'], ['geomancer', 'Géomancien', 'Geomancer'], ['holy_liberator', 'Libérateur sacré', 'Holy Liberator'], ['hospitaler', 'Chevalier hospitalier', 'Hospitaler'], ['pious_templar', 'Templier consacré', 'Pious Templar'], ['radiant_servant_of_pelor', 'Serviteur radieux de Pélor', 'Radiant Servant of Pelor'], ['rainbow_servant', 'Serviteur arc-en-ciel', 'Rainbow Servant'], ['sacred_exorcist', 'Exorciste consacré', 'Sacred Exorcist'], ['sacred_fist', 'Poing sacré', 'Sacred Fist'], ['seeker_of_the_misty_isle', 'Quêteur de l’île des Brumes', 'Seeker of the Misty Isle'], ['shining_blade_of_heironeous', 'Lame étincelante d’Héronéus', 'Shining Blade of Heironeous'], ['stormlord', 'Seigneur des tempêtes', 'Stormlord'], ['temple_raider_of_olidammara', 'Pilleur de temple d’Olidammara', 'Temple Raider of Olidammara'], ['ur_priest', 'Prêtre déicide', 'Ur-Priest'], ['void_disciple', 'Disciple du Vide', 'Void Disciple'], ['warpriest', 'Prêtre de guerre', 'Warpriest'],
  ]),
  ...family('gilt', ['class', 'prestige_class'], [
    ['base', 'Classe de base', 'Base class'], ['arcane', 'Profane', 'Arcane'], ['divine', 'Divine', 'Divine'],
    ['prepared', 'Préparée', 'Prepared'], ['spontaneous', 'Spontanée', 'Spontaneous'], ['explorer', 'Explorateur', 'Explorer'],
    ['knowledge', 'Savoir', 'Knowledge'],
  ]),
  ...family('garnet', ['maneuver', 'stance'], [
    ['strike', 'Coup', 'Strike'], ['boost', 'Renforcement', 'Boost'], ['counter', 'Contre', 'Counter'],
    ['supernatural', 'Surnaturelle', 'Supernatural'],
  ]),
  ...family('gilt', ['class'], [['initiator', 'Initiateur', 'Initiator'], ['invoker', 'Invocateur', 'Invoker'], ['free_slots', 'Sorts libres', 'Free slots']]),
  ...family('gilt', ['prestige_class'], [
    ['crafting', 'Artisanat', 'Crafting'], ['elemental', 'Élémentaire', 'Elemental'], ['force', 'Force', 'Force'],
    ['luck', 'Chance', 'Luck'], ['shapechange', 'Métamorphose', 'Shapechange'], ['transformation', 'Transformation', 'Transformation'],
    ['nature', 'Nature', 'Nature'], ['bardic', 'Musique', 'Music'],
  ]),
  ...family('focus', ['spell'], [
    ['wu_jen_metal', 'Métal (wu jen)', 'Metal (wu jen)'], ['wu_jen_wood', 'Bois (wu jen)', 'Wood (wu jen)'],
    ['wu_jen_fire', 'Feu (wu jen)', 'Fire (wu jen)'], ['wu_jen_water', 'Eau (wu jen)', 'Water (wu jen)'],
    ['wu_jen_earth', 'Terre (wu jen)', 'Earth (wu jen)'],
  ]),
  ...family('seal', ['invocation'], [
    ['least', 'Inférieure', 'Least'], ['lesser', 'Mineure', 'Lesser'], ['greater', 'Majeure', 'Greater'], ['dark', 'Suprême', 'Dark'],
    ['essence', 'Invocation fantastique', 'Eldritch essence'], ['blast_shape', 'Invocation façonnée', 'Blast shape'],
  ]),
  ...family('muted', ['race'], [
    ['small', 'Taille P', 'Small'], ['medium', 'Taille M', 'Medium'], ['large', 'Taille G', 'Large'],
  ]),
  ...family('muted', ['race', 'template'], [
    ['fiend', 'Fiélon', 'Fiend'], ['undead', 'Mort-vivant', 'Undead'], ['dragon', 'Dragon', 'Dragon'], ['vampire', 'Vampire', 'Vampire'],
  ]),
  ...family('muted', ['class_power', 'feat', 'template'], [
    ['aura', 'Aura', 'Aura'], ['hit_points', 'Points de vie', 'Hit points'], ['regeneration', 'Régénération', 'Regeneration'],
    ['saves', 'Sauvegardes', 'Saves'], ['form', 'Forme', 'Form'], ['stone_power', 'Pouvoir de la pierre', 'Stone power'], ['tattoo', 'Tatouage', 'Tattoo'],
  ]),
]

const BY_ID = new Map(LABELS.map((l) => [l.id, l]))

/** Labels found in today's content under another name. */
const ALIASES: Record<string, string> = {
  invocation: 'conjuration', évocation: 'evocation', enchantement: 'enchantment', nécromancie: 'necromancy', universel: 'universal',
  creation: 'item_creation', DC: 'dc', 'caster level': 'caster_level', 'hit points': 'hit_points', 'epic spell': 'epic',
  'epic-friendly': 'epic', 'spell modifier': 'metamagic', 'dual casting': 'mystic_theurge', skills: 'skill', combat: 'melee',
  'high arcana': 'archmage', loremaster_secret: 'loremaster',
}

/** Labels that only repeat the entry's type: not shown. */
const SAME_AS_TYPE = new Set([
  'spell', 'spells', 'spellcasting', 'item', 'class_power', 'class', 'prestige', 'domain', 'race', 'alignment', 'template',
  'stance', 'maneuvers', 'bonus type',
])

/** The curated label behind a stored one, if any. */
export function labelFor(stored: string): Label | undefined {
  return BY_ID.get(ALIASES[stored] ?? stored)
}

/** The labels to show on an entry: curated ones first, in list order, then the unknown ones as they are. */
export function shownLabels(type: string, stored: string[]): (Label | string)[] {
  const kept = stored.filter((l) => l !== type && !SAME_AS_TYPE.has(l))
  const known = [...new Set(kept.map(labelFor).filter((l): l is Label => !!l))].sort((a, b) => LABELS.indexOf(a) - LABELS.indexOf(b))
  return [...known, ...kept.filter((l) => !labelFor(l))]
}

/** The labels the editor offers for a type. */
export function labelsForType(type: string): Label[] {
  return LABELS.filter((l) => l.types.includes(type))
}

/** An entry's labels in one line, for a list row. */
export function labelLine(type: string, stored: string[]): string {
  return shownLabels(type, stored).map((l) => (typeof l === 'string' ? l.replaceAll('_', ' ') : l.fr)).join(' · ')
}

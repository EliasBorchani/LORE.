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
  ...family('muted', ['feat'], [
    ['general', 'Général', 'General'], ['skill', 'Compétence', 'Skill'], ['epic', 'Épique', 'Epic'],
    ['monster', 'Monstre', 'Monster'], ['story', 'Histoire', 'Story'], ['custom', 'Maison', 'House'],
    ['tactical', 'Tactique', 'Tactical'], ['psionic', 'Psionique', 'Psionic'],
  ]),
  ...family('garnet', ['feat'], [
    ['fighter_bonus', 'Bonus de guerrier', 'Fighter bonus'], ['warblade_bonus', 'Bonus de maître des lames', 'Warblade bonus'], ['melee', 'Corps à corps', 'Melee'], ['ranged', 'Distance', 'Ranged'],
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
  ...family('gilt', ['class'], [['initiator', 'Initiateur', 'Initiator']]),
  ...family('muted', ['race'], [
    ['small', 'Taille P', 'Small'], ['medium', 'Taille M', 'Medium'], ['large', 'Taille G', 'Large'],
  ]),
  ...family('muted', ['race', 'template'], [
    ['fiend', 'Fiélon', 'Fiend'], ['undead', 'Mort-vivant', 'Undead'], ['dragon', 'Dragon', 'Dragon'], ['vampire', 'Vampire', 'Vampire'],
  ]),
  ...family('muted', ['class_power', 'feat', 'template'], [
    ['aura', 'Aura', 'Aura'], ['hit_points', 'Points de vie', 'Hit points'], ['regeneration', 'Régénération', 'Regeneration'],
    ['saves', 'Sauvegardes', 'Saves'], ['form', 'Forme', 'Form'],
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

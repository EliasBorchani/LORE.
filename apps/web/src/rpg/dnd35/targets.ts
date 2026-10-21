import type { ChoiceKind } from '../../api/types'
import { abilities, statLabels } from '../../i18n/fr'

/** A statistic an effect can change, as the editor offers it. */
export interface TargetOption {
  key: string
  label: string
}

export interface TargetGroup {
  label: string
  options: TargetOption[]
}

export const SCHOOLS: TargetOption[] = [
  { key: 'abjuration', label: 'Abjuration' },
  { key: 'conjuration', label: 'Invocation' },
  { key: 'divination', label: 'Divination' },
  { key: 'enchantment', label: 'Enchantement' },
  { key: 'evocation', label: 'Évocation' },
  { key: 'illusion', label: 'Illusion' },
  { key: 'necromancy', label: 'Nécromancie' },
  { key: 'transmutation', label: 'Transmutation' },
]

export const ABILITY_SCORES: TargetOption[] = [
  ...abilities.map((a) => ({ key: `ability.${a.id}.score`, label: a.name })),
  { key: 'ability.all.score', label: 'Toutes les caractéristiques' },
]

export const SAVES: TargetOption[] = [
  { key: 'save.fort', label: 'Vigueur' },
  { key: 'save.ref', label: 'Réflexes' },
  { key: 'save.will', label: 'Volonté' },
  { key: 'save.all', label: 'Tous les jets de sauvegarde' },
]

export const DEFENSE: TargetOption[] = [
  { key: 'ac.total', label: 'Classe d’armure' },
  { key: 'ac.natural', label: 'Armure naturelle' },
  { key: 'spell_resistance', label: 'Résistance à la magie' },
  { key: 'damage_reduction.none', label: 'Réduction des dégâts' },
  { key: 'hp.max', label: 'Points de vie' },
  { key: 'hp.temporary', label: 'Points de vie temporaires' },
]

export const ATTACKS: TargetOption[] = [
  { key: 'attack.all', label: 'Tous les jets d’attaque' },
  { key: 'attack.melee', label: 'Attaque au corps à corps' },
  { key: 'attack.ranged', label: 'Attaque à distance' },
]

export const DAMAGE: TargetOption[] = [
  { key: 'damage.all', label: 'Tous les dégâts' },
  { key: 'damage.melee', label: 'Dégâts au corps à corps' },
]

export const FEAT_SLOTS: TargetOption[] = [
  { key: 'feat_slots.epic_bonus', label: 'Dons épiques en bonus' },
  { key: 'feat_slots.fighter_bonus', label: 'Dons de guerrier en bonus' },
  { key: 'feat_slots.wizard_bonus', label: 'Dons de magicien en bonus' },
  { key: 'feat_slots.monk_bonus', label: 'Dons de moine en bonus' },
  { key: 'feat_slots.rogue_special', label: 'Talents spéciaux de roublard' },
]

const OTHER: TargetOption[] = [
  { key: 'initiative', label: 'Initiative' },
  { key: 'speed.land', label: 'Vitesse au sol' },
  { key: 'bab', label: 'Bonus de base à l’attaque' },
  { key: 'skill_points.total', label: 'Points de compétence' },
  { key: 'armor.check_penalty', label: 'Malus d’armure aux tests' },
  { key: 'spell_failure.arcane', label: 'Échec des sorts profanes' },
  { key: 'turn_undead.level', label: 'Niveau de renvoi des morts-vivants' },
  { key: 'size', label: 'Taille' },
  { key: 'vision.darkvision', label: 'Vision dans le noir' },
]

/** « d’abjuration », « de divination ». */
export function ofWord(word: string): string {
  return /^[aeiouyéèêàâîôûh]/i.test(word) ? `d’${word}` : `de ${word}`
}

export const SCHOOL_DCS: TargetOption[] = SCHOOLS.map((s) => ({ key: `dc.school[${s.key}]`, label: `DD des sorts ${ofWord(s.label.toLowerCase())}` }))

/** What an effect of a repeatable entry targets to follow each take's choice (`{choice}`, as the engine reads it). */
export const CHOICE_TARGETS: Record<ChoiceKind, TargetOption> = {
  skill: { key: '{choice}', label: 'la compétence choisie' },
  school: { key: 'dc.school[{choice}]', label: 'le DD des sorts de l’école choisie' },
  class: { key: 'caster_level.class[{choice}]', label: 'le niveau de lanceur de la classe choisie' },
}

/**
 * Every target the pickers offer; skills come from the catalog (their names are the group's). A repeatable entry
 * whose takes choose something gets its choice first.
 */
export function targetGroups(skills: TargetOption[], choose?: ChoiceKind | '' | null): TargetGroup[] {
  return [
    ...(choose ? [{ label: 'Choisi à chaque prise', options: [CHOICE_TARGETS[choose]] }] : []),
    { label: 'Caractéristiques', options: ABILITY_SCORES },
    { label: 'Jets de sauvegarde', options: SAVES },
    { label: 'Défense', options: DEFENSE },
    { label: 'Attaque', options: ATTACKS },
    { label: 'Dégâts', options: DAMAGE },
    { label: 'Compétences', options: skills },
    { label: 'Magie', options: SCHOOL_DCS },
    { label: 'Dons', options: FEAT_SLOTS },
    { label: 'Autres', options: OTHER },
  ]
}

const KNOWN = new Map(
  [...ABILITY_SCORES, ...SAVES, ...DEFENSE, ...ATTACKS, ...DAMAGE, ...FEAT_SLOTS, ...OTHER, ...SCHOOL_DCS, ...Object.values(CHOICE_TARGETS)]
    .map((t) => [t.key, t.label]),
)

/**
 * A target's name in French: the editor's lists, then the sheet's labels, then a catalog name (a skill), else the key
 * as written.
 */
export function targetLabel(key: string, names: ReadonlyMap<string, string>): string {
  return KNOWN.get(key) ?? statLabels[key] ?? names.get(key) ?? key
}

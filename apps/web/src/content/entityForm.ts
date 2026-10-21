/** The id prefix of a type, when it is not the type itself. */
const ID_PREFIX: Record<string, string> = { class_power: 'power', prestige_class: 'class' }

/**
 * `feat` + « Volonté de fer » → `feat.volonte_de_fer`, or `eberron:feat.volonte_de_fer` in the ruleset `eberron`. Ids
 * are English by convention: the English name goes first.
 */
export function idFrom(type: string, name: string, slug?: string): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!words) return ''
  const id = `${ID_PREFIX[type] ?? type}.${words}`
  return slug ? `${slug}:${id}` : id
}

/** A piece of a readable prerequisite: plain text, or an entity shown by its name. */
export type PrerequisitePart = { text: string } | { id: string; name: string }

export interface PrerequisiteWords {
  stats: Record<string, string>
  ranks: string
  and: string
  or: string
  characterLevel: string
  levelOf: string
}

const TOKEN = /has\('([^']+)'\)|level\('([^']+)'\)|level\(\)|@([a-z0-9_.:]+)|>=|<=|\band\b|\bor\b/g

/**
 * `@ability.str.score >= 13 and has('feat.power_attack')` → « Force ≥ 13 et » + Attaque en puissance. [names] holds the
 * entities the server found in the content; an id or a statistic it does not know stays as written.
 */
export function prerequisiteParts(formula: string, names: Map<string, string>, words: PrerequisiteWords): PrerequisitePart[] {
  const parts: PrerequisitePart[] = []
  const text = (t: string) => {
    if (!t) return
    const last = parts.at(-1)
    if (last && 'text' in last) last.text += t
    else parts.push({ text: t })
  }
  const entity = (id: string, raw: string) => {
    const name = names.get(id)
    if (name) parts.push({ id, name })
    else text(raw)
  }
  let at = 0
  for (const match of formula.matchAll(TOKEN)) {
    text(formula.slice(at, match.index))
    at = match.index + match[0].length
    const [raw, hasId, levelId, stat] = match
    if (hasId) entity(hasId, raw)
    else if (levelId) {
      if (names.has(levelId)) {
        text(`${words.levelOf} `)
        entity(levelId, raw)
      } else text(raw)
    } else if (raw === 'level()') text(words.characterLevel)
    else if (stat) {
      const skill = /^((?:[a-z][a-z0-9_]*:)?skill\.[a-z0-9_]+)\.ranks$/.exec(stat)?.[1]
      if (words.stats[stat]) text(words.stats[stat])
      else if (skill && names.has(skill)) {
        entity(skill, raw)
        text(` (${words.ranks})`)
      } else text(raw)
    } else text({ '>=': '≥', '<=': '≤', and: words.and, or: words.or }[raw] ?? raw)
  }
  text(formula.slice(at))
  return parts
}

import type { Character, Entity, Localized } from '../api/types'

export function localized(text: Localized | null | undefined): string | null {
  return text?.fr ?? text?.en ?? null
}

/** French name, else English, else the id itself. */
export function entityName(entity: Pick<Entity, 'name'> | undefined, id: string): string {
  return localized(entity?.name) ?? id
}

/** « Maître des lames 20 · Mage ultime 20 · … »: each class with its level, most levels first. */
export function classSummary(character: Character, name: (id: string) => string): string {
  const counts = new Map<string, number>()
  for (const record of character.levels ?? []) counts.set(record.classId, (counts.get(record.classId) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([classId, level]) => `${name(classId)} ${level}`)
    .join(' · ')
}

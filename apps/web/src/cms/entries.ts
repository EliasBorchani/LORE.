import type { TargetGroup, TargetOption } from '../rpg/dnd35/targets'

/** Catalog entries the form picks from a dropdown, and can add to the ruleset from there. */
export type EntryType = 'source' | 'statistic' | 'situation'

export const ENTRY_TYPES: EntryType[] = ['source', 'statistic', 'situation']

export function slugOf(id: string): string | null {
  return /^([a-z][a-z0-9_]*):/.exec(id)?.[1] ?? null
}

/**
 * Entries by where they come from: the RPG's official ones first (`official`), then one group per ruleset of the
 * group, in its order, named after it (« Maison — statistiques »). Each group is sorted by name.
 */
export function groupEntries(
  entries: TargetOption[],
  rulesets: { slug: string; name: string }[],
  labels: { official: string; inRuleset: (ruleset: string) => string },
): TargetGroup[] {
  const sorted = [...entries].sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  const groups: TargetGroup[] = [{ label: labels.official, options: sorted.filter((e) => slugOf(e.key) == null) }]
  const known = new Set(rulesets.map((r) => r.slug))
  for (const r of rulesets) groups.push({ label: labels.inRuleset(r.name), options: sorted.filter((e) => slugOf(e.key) === r.slug) })
  const others = sorted.filter((e) => {
    const slug = slugOf(e.key)
    return slug != null && !known.has(slug)
  })
  if (others.length) groups.push({ label: labels.inRuleset('?'), options: others })
  return groups.filter((g) => g.options.length > 0)
}

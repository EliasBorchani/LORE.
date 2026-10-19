import { Link } from 'react-router'
import type { SkillLine } from 'dnd-engine'
import { formatModifier } from '../../format'
import { abilities, fr } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'

/** Every skill with its total; ranks, class skill and armor penalty under it. Opens the breakdown. */
export function SkillsTab() {
  const { sheet, name, record } = useSheet()
  const skills = sortedSkills(sheet.skills.asJsReadonlyArrayView(), name)
  if (skills.length === 0) return <p className="muted">{fr.sheet.noSkills}</p>
  return (
    <div className="list">
      {skills.map((s) => {
        // A skill that needs training cannot be used without ranks: its total is shown muted.
        const unusable = s.trainedOnly && s.ranks === '0'
        return (
          <Link key={s.id} className="list-row" to={`/characters/${record.id}/stat/${s.id}`}>
            <span className="list-row-text">
              <span className="list-row-title">{name(s.id)}</span>
              <span className="list-row-sub">{skillDetails(s)}</span>
            </span>
            <span className={`type-stat-m${unusable ? ' muted' : ''}`}>{s.total == null ? '—' : formatModifier(s.total)}</span>
          </Link>
        )
      })}
    </div>
  )
}

export function sortedSkills(skills: readonly SkillLine[], name: (id: string) => string): SkillLine[] {
  return [...skills].sort((a, b) => name(a.id).localeCompare(name(b.id), 'fr'))
}

type SkillFacts = Pick<SkillLine, 'ability' | 'ranks' | 'maxRanks' | 'classSkill' | 'trainedOnly' | 'armorCheckPenalty'>

export function skillDetails(s: SkillFacts): string {
  const ability = abilities.find((a) => a.id === s.ability)?.short ?? s.ability
  return [
    ability,
    fr.sheet.skillRanks(s.ranks, s.maxRanks ?? '—'),
    s.classSkill ? fr.sheet.classSkill : null,
    s.trainedOnly ? fr.sheet.trainedOnly : null,
    s.armorCheckPenalty ? fr.sheet.armorPenalty : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

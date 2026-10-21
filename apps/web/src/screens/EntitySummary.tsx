import { Link } from 'react-router'
import type { EntityDetail } from '../api/types'
import { LabelTags } from '../cms/Labels'
import { EntityName } from '../components/EntityPanel'
import { prerequisiteParts } from '../content/prerequisite'
import { fr, statLabels } from '../i18n/fr'
import { effectText } from '../rpg/dnd35/describe'
import { localized } from '../sheet/names'
import { useGroupPath } from '../group/GroupContext'

/** What an entity does: its facts, description and effects. The catalog page and the info panel both show it. */
export function EntitySummary({ detail }: { detail: EntityDetail }) {
  return (
    <>
      <EntityFacts detail={detail} />
      <EntityText detail={detail} />
    </>
  )
}

/** Labels, prerequisite, spell levels and fields, uses per day. */
export function EntityFacts({ detail }: { detail: EntityDetail }) {
  const groupPath = useGroupPath()
  const { content: entity, relations = [] } = detail
  const spellLevels = relations
    .filter((r) => r.relation === 'on_spell_list')
    .map((r) => ({ id: r.to, name: localized(r.name ?? undefined) ?? r.to, level: r.extra.level }))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, 'fr'))
  const spell = entity.type === 'spell' ? ((entity.spell ?? {}) as Record<string, unknown>) : null

  return (
    <>
      {entity.labels && <LabelTags type={entity.type} labels={entity.labels} />}
      <dl className="facts">
        {entity.prerequisite && (
          <>
            <dt>{fr.catalog.prerequisite}</dt>
            <dd><Prerequisite formula={entity.prerequisite} detail={detail} /></dd>
          </>
        )}
        {spell && (
          <>
            <dt>{fr.catalog.spellLevels}</dt>
            <dd>
              {spellLevels.length === 0 && fr.catalog.noSpellLevel}
              {spellLevels.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ' · '}
                  <Link to={groupPath(`/catalog/entity/${l.id}`)}>{l.name}</Link> {l.level}
                </span>
              ))}
            </dd>
          </>
        )}
        {spell &&
          Object.entries(fr.catalog.spellFields).map(([field, label]) => {
            const value = spell[field]
            const text = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
            return text ? (
              <div key={field} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ) : null
          })}
        {entity.usesPerDay != null && (
          <>
            <dt>{fr.catalog.usesPerDay}</dt>
            <dd className="formula">{String(entity.usesPerDay)}</dd>
          </>
        )}
      </dl>
    </>
  )
}

export function EntityText({ detail }: { detail: EntityDetail }) {
  const entity = detail.content
  const names = new Map((detail.references ?? []).map((r) => [r.id, localized(r.name) ?? r.id]))
  names.set(entity.id, localized(entity.name) ?? entity.id)
  const description = localized(entity.description)
  return (
    <>
      {description && (
        <section className="page-head">
          <h2 className="type-heading">{fr.catalog.description}</h2>
          <p className="type-body-l prose">{description}</p>
        </section>
      )}
      {entity.effects && entity.effects.length > 0 && (
        <section className="page-head">
          <h2 className="type-heading">{fr.catalog.effects}</h2>
          <ul className="effect-list">{entity.effects.map((e, i) => <li key={i}>{effectText(e, names)}</li>)}</ul>
        </section>
      )}
    </>
  )
}

function Prerequisite({ formula, detail }: { formula: string; detail: EntityDetail }) {
  // An older server sends no references: the formula stays as written.
  if (!detail.references) return <span className="formula">{formula}</span>
  const names = new Map(detail.references.map((r) => [r.id, localized(r.name) ?? r.id]))
  const parts = prerequisiteParts(formula, names, { ...fr.panel, stats: statLabels })
  return (
    <>
      {parts.map((part, i) => ('id' in part ? <EntityName key={i} id={part.id}>{part.name}</EntityName> : <span key={i}>{part.text}</span>))}
    </>
  )
}

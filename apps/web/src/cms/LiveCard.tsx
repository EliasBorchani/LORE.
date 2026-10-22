import type { Entity, EntityDetail, SpellLevel } from '../api/types'
import { Badge } from '../components/grimoire'
import { fr, typeName } from '../i18n/fr'
import { blurbOf, cardOf } from '../rpg/dnd35/cards'
import { EntitySummary } from '../screens/EntitySummary'
import { entityName, localized } from '../sheet/names'
import { useCms } from './context'
import { EntityCard } from './EntityCard'
import { TypeBanner } from './TypeBanner'

/** The entry as the catalog will show it, from what is typed now: the same component as the catalog page. */
export function LiveCard({ entity, ruleset, houseRule, spellLevels }: { entity: Entity; ruleset?: string; houseRule: boolean; spellLevels: SpellLevel[] }) {
  const { names } = useCms()
  const detail: EntityDetail = {
    id: entity.id,
    type: entity.type,
    version: 0,
    content: entity,
    editable: false,
    relations: spellLevels.map((l) => ({ relation: 'on_spell_list', to: l.to, extra: { level: l.level }, name: names.has(l.to) ? { fr: names.get(l.to) } : null })),
    references: [...names].map(([id, name]) => ({ id, type: '', name: { fr: name } })),
  }
  const { description, name: _name, ...rest } = entity
  const card = { ...rest, spellLevels: spellLevels.map((l) => ({ list: l.to, level: l.level })) }
  return (
    <>
    <p className="cms-sublabel">{fr.cms.inCatalog}</p>
    <EntityCard model={cardOf({ type: entity.type, labels: entity.labels, card }, names, blurbOf(localized(description) ?? undefined))} title={entityName(entity, '…')}
      aside={(ruleset || houseRule) && <Badge ruleset={ruleset} houseRule={houseRule} />} />
    <p className="cms-sublabel">{fr.cms.fullCard}</p>
    <article className="live-card">
      <TypeBanner type={entity.type} />
      <div className="live-card-body">
        <div className="live-card-head">
          <h2 className="live-card-title">{entityName(entity, '…')}</h2>
          <span className="muted">{typeName(entity.type)}</span>
          <Badge ruleset={ruleset} houseRule={houseRule} provenance={entity.provenance} />
        </div>
        <EntitySummary detail={detail} />
      </div>
    </article>
    </>
  )
}

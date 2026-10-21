import type { Entity, EntityDetail, SpellLevel } from '../api/types'
import { Badge } from '../components/grimoire'
import { typeName } from '../i18n/fr'
import { EntitySummary } from '../screens/EntitySummary'
import { entityName } from '../sheet/names'
import { useCms } from './context'
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
  return (
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
  )
}

import { Link } from 'react-router'
import { StatBlock, StatTile } from '../../components/grimoire'
import { formatModifier, formatNumber } from '../../format'
import { abilities, fr, statLabels } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'

/** Modifier as the number, score under it (Grimoire StatTile rule for abilities). */
export function AbilityTiles() {
  const { stat, record } = useSheet()
  return (
    <section className="abilities" aria-label={fr.sheet.tabs.abilities}>
      {abilities.map((a) => {
        const score = stat(`ability.${a.id}.score`)
        const mod = stat(`ability.${a.id}.mod`)
        if (score == null || mod == null) return null
        return (
          <StatTile key={a.id} value={formatModifier(mod)} label={a.short} extra={formatNumber(score)}
            to={`/characters/${record.id}/stat/ability.${a.id}.score`} />
        )
      })}
    </section>
  )
}

export function AbilitiesTab() {
  const { sheet, stat, name, record } = useSheet()
  // `caster_level.wizard` per class; the `class[...]` family and `arcane` are parts of those totals.
  const casterLevels = sheet.statistics
    .asJsReadonlyArrayView()
    .filter((s) => /^caster_level\.[a-z_]+$/.test(s.key) && s.key !== 'caster_level.arcane')
  const others = ['hp.max', 'hp.base', 'ac.total', 'attack.ranged', 'spell_resistance']

  return (
    <>
      <AbilityTiles />
      <StatBlock title={fr.sheet.tabs.abilities}>
        <dl className="facts">
          {casterLevels.map((s) => (
            <Fact key={s.key} id={record.id} statKey={s.key}
              label={fr.sheet.casterLevel(name(`class.${s.key.slice('caster_level.'.length)}`))} value={formatNumber(s.text)} />
          ))}
          {others.map((key) => {
            const value = stat(key)
            return value == null ? null : <Fact key={key} id={record.id} statKey={key} label={statLabels[key]} value={formatNumber(value)} />
          })}
        </dl>
      </StatBlock>
    </>
  )
}

function Fact({ id, statKey, label, value }: { id: string; statKey: string; label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <Link to={`/characters/${id}/stat/${statKey}`}>{value}</Link>
      </dd>
    </>
  )
}

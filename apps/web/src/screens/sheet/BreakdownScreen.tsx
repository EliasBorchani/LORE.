import { useParams } from 'react-router'
import type { BreakdownRow as EngineRow } from 'dnd-engine'
import { BreakdownRow } from '../../components/grimoire'
import { formatModifier, formatNumber, splitDice } from '../../format'
import { bonusTypes, breakdownStatus, breakdownSteps, fr, statLabels } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'
import { CharacterHeader } from './CharacterLayout'

/** Where a number comes from: every source, including the ones that did not count and why (Grimoire BreakdownRow). */
export function BreakdownScreen() {
  const key = useParams().key!
  const { sheet, stat, record, name, entity } = useSheet()
  const total = stat(key)
  const rows = sheet.explain(key).asJsReadonlyArrayView()
  const label = statLabels[key] ?? (entity(key) ? name(key) : key)

  // A line's source is an entity, a component statistic, or `definition` for the base formula.
  const sourceName = (source: string) =>
    source === 'definition' ? fr.breakdown.base : entity(source) ? name(source) : (statLabels[source] ?? source)
  const counted = rows.filter((r) => r.status !== 'situational')
  const situational = rows.filter((r) => r.status === 'situational')

  return (
    <>
      <CharacterHeader back={`/characters/${record.id}`} backLabel={record.character.name} />
      <section className="page-head">
        <h2 className="type-heading">{label}</h2>
        <span className="type-stat-xl">{total == null ? '—' : display(total, isModifier(key))}</span>
      </section>
      {total == null ? (
        <p className="muted">{fr.breakdown.unknown}</p>
      ) : (
        <section className="block breakdown" aria-label={fr.breakdown.sources}>
          {counted.length === 0 && <p className="muted">{fr.breakdown.noLines}</p>}
          {counted.map((row, i) => (
            <BreakdownRow
              key={i}
              source={sourceName(row.source)}
              detail={detail(row, name)}
              value={display(row.value, row.step === 'add' || isModifier(row.source))}
              out={row.status !== 'applied'}
              to={row.step === 'component' && stat(row.source) != null ? `/characters/${record.id}/stat/${row.source}` : undefined}
            />
          ))}
          <div className="breakdown-total">
            <span className="l">{fr.breakdown.total}</span>
            <span className="v">{display(total, isModifier(key))}</span>
          </div>
        </section>
      )}
      {situational.map((row, i) => (
        <p key={i} className="muted">
          {fr.breakdown.situational} {formatModifier(row.value)} ({sourceName(row.source)}
          {row.situation ? ` · ${situationName(row.situation)}` : ''})
        </p>
      ))}
    </>
  )
}

function detail(row: EngineRow, name: (id: string) => string): string {
  const parts = [
    row.step !== 'add' ? breakdownSteps[row.step] : null,
    row.bonusType ? bonusTypes[row.bonusType] ?? row.bonusType : null,
    ...row.modifiers.asJsReadonlyArrayView().map(name),
    row.status !== 'applied' && row.status !== 'situational'
      ? breakdownStatus[row.status]?.(row.suppressedBy ? name(row.suppressedBy) : '') ?? row.status
      : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/** Saves, attacks and ability modifiers are signed. */
const isModifier = (key: string) => /^(save\.|attack\.|skill\.)|\.mod$|^initiative$/.test(key)

/** Dice keep their average apart; modifiers and bonus lines are signed; the rest is a plain number. */
function display(text: string, signed: boolean): string {
  if (/\dd\d/.test(text)) {
    const dice = splitDice(text)
    return dice.average ? `${dice.expression} (~${dice.average})` : dice.expression
  }
  return signed ? formatModifier(text) : formatNumber(text)
}

/** `situation.vs_evil` → `vs evil`: situations are ids, not catalog entities yet. */
function situationName(id: string): string {
  return id.replace(/^situation\./, '').replaceAll('_', ' ')
}

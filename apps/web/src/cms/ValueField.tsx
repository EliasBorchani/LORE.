import { abilities, fr } from '../i18n/fr'
import { DAMAGE_TYPES } from '../rpg/dnd35/describe'
import { ABILITY_IDS, parseValue, selfToggle, valueFormula, type AbilityId, type LevelSource, type ValueModel } from '../rpg/dnd35/formulas'
import { useCms } from './context'

type Kind = ValueModel['kind']

const DICE_SIDES = [2, 3, 4, 6, 8, 10, 12, 20]

function start(kind: Kind, classes: { key: string }[]): ValueModel {
  switch (kind) {
    case 'number': return { kind, n: 1 }
    case 'perLevel': return { kind, n: 1, every: 1, source: classes[0] ? { kind: 'class', classId: classes[0].key } : { kind: 'character' } }
    case 'ability': return { kind, ability: 'cha' }
    case 'table': return { kind, times: 1 }
    case 'dice': return { kind, count: 1, sides: 6 }
    case 'other': return { kind, text: '' }
  }
}

function sourceKey(source: LevelSource): string {
  return source.kind === 'class' ? source.classId : source.kind
}

function sourceOf(key: string): LevelSource {
  return key === 'character' || key === 'caster' || key === 'initiator' ? { kind: key } : { kind: 'class', classId: key }
}

function Int({ value, onChange, label, min }: { value: number; onChange: (n: number) => void; label: string; min?: number }) {
  return (
    <input className="input input-number" type="number" inputMode="numeric" value={value} min={min} aria-label={label}
      onChange={(e) => onChange(Math.max(min ?? -Infinity, Math.trunc(Number(e.target.value) || 0)))} />
  )
}

/**
 * An effect's value from dropdowns: a number, so much per level, an ability modifier, the value picked at the table,
 * dice. A formula none of them can say shows as written and stays untouched (« Avancé » edits it).
 */
export function ValueField({ value, onChange, dice }: { value: string | number; onChange: (value: string | number) => void; dice?: boolean }) {
  const { classes, selfId, tableValue } = useCms()
  const toggle = selfToggle(selfId)
  const model = parseValue(value, toggle)
  const offered: Kind[] = [...(dice ? ['dice' as const] : []), 'number', 'perLevel', 'ability', ...(tableValue && toggle ? ['table' as const] : [])]
  // The current kind stays listed even when no longer offered (dice after the operation changed), so nothing jumps.
  const kinds = offered.includes(model.kind) ? offered : [...offered, model.kind]
  const emit = (next: ValueModel) => onChange(valueFormula(next, toggle))
  const t = fr.cms.value

  return (
    <div className="cms-subfield">
      <label className="field">
        <span className="cms-sublabel">{fr.cms.effects.value}</span>
        <select className="input" value={model.kind} onChange={(e) => emit(start(e.target.value as Kind, classes))}>
          {kinds.map((k) => <option key={k} value={k} disabled={k === 'other'}>{t.kinds[k]}</option>)}
        </select>
      </label>
      {model.kind === 'number' && (
        <input className="input input-number" type="number" inputMode="decimal" value={model.n} aria-label={t.kinds.number}
          onChange={(e) => emit({ ...model, n: Number(e.target.value) || 0 })} />
      )}
      {model.kind === 'perLevel' && (
        <div className="cms-row-inputs">
          <Int value={model.n} label={t.amount} onChange={(n) => emit({ ...model, n })} />
          <select className="input" value={model.every} aria-label={t.every} onChange={(e) => emit({ ...model, every: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k === 1 ? t.perLevel : t.everyLevels(k)}</option>)}
          </select>
          <select className="input" value={sourceKey(model.source)} aria-label={t.source} onChange={(e) => emit({ ...model, source: sourceOf(e.target.value) })}>
            <option value="character">{t.character}</option>
            <option value="caster">{t.caster}</option>
            <option value="initiator">{t.initiator}</option>
            <optgroup label={t.classes}>
              {model.source.kind === 'class' && !classes.some((c) => c.key === sourceKey(model.source)) && (
                <option value={sourceKey(model.source)}>{sourceKey(model.source)}</option>
              )}
              {classes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </optgroup>
          </select>
          <label className="cms-inline">
            <span className="cms-sublabel">{t.after}</span>
            <input className="input input-number" type="number" inputMode="numeric" min={1} value={model.after ?? ''} placeholder="—" aria-label={t.after}
              onChange={(e) => {
                const after = Math.trunc(Number(e.target.value) || 0)
                emit({ ...model, after: after > 0 ? after : undefined })
              }} />
          </label>
          <label className="cms-inline">
            <span className="cms-sublabel">{t.atMost}</span>
            <input className="input input-number" type="number" inputMode="numeric" min={0} value={model.max ?? ''} placeholder="—" aria-label={t.atMost}
              onChange={(e) => emit({ ...model, max: e.target.value === '' ? undefined : Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
          </label>
        </div>
      )}
      {model.kind === 'ability' && (
        <select className="input" value={model.ability} aria-label={t.kinds.ability} onChange={(e) => emit({ ...model, ability: e.target.value as AbilityId })}>
          {ABILITY_IDS.map((id) => <option key={id} value={id}>{abilities.find((a) => a.id === id)!.name}</option>)}
        </select>
      )}
      {model.kind === 'table' && (
        <div className="cms-row-inputs">
          <select className="input input-sign" value={model.times < 0 ? '-' : '+'} aria-label={t.sign} onChange={(e) => emit({ ...model, times: Math.abs(model.times) * (e.target.value === '-' ? -1 : 1) })}>
            <option value="+">{t.plus}</option>
            <option value="-">{t.minus}</option>
          </select>
          <span className="muted">×</span>
          <Int value={Math.abs(model.times)} min={1} label={t.times} onChange={(n) => emit({ ...model, times: n * (model.times < 0 ? -1 : 1) })} />
          <span className="muted">{t.chosen}</span>
        </div>
      )}
      {model.kind === 'dice' && (
        <div className="cms-row-inputs">
          <Int value={model.count} min={1} label={t.diceCount} onChange={(count) => emit({ ...model, count })} />
          <span className="muted">d</span>
          <select className="input" value={model.sides} aria-label={t.diceSides} onChange={(e) => emit({ ...model, sides: Number(e.target.value) })}>
            {!DICE_SIDES.includes(model.sides) && <option value={model.sides}>{model.sides}</option>}
            {DICE_SIDES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={model.damage ?? ''} aria-label={t.damage} onChange={(e) => emit({ ...model, damage: e.target.value || undefined })}>
            <option value="">{t.noDamage}</option>
            {model.damage && !(model.damage in DAMAGE_TYPES) && <option value={model.damage}>{model.damage}</option>}
            {Object.entries(DAMAGE_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      )}
      {model.kind === 'other' && <p className="field-hint">{t.other} <code>{model.text}</code></p>}
    </div>
  )
}

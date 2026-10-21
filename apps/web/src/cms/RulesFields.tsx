import { useEffect } from 'react'
import { abilities, fr } from '../i18n/fr'
import type { ChoiceKind } from '../api/types'
import { ABILITY_IDS, parsePrerequisite, parseUses, prerequisiteFormula, usesValue, type AbilityId, type PrerequisiteRow, type UsesPerDay } from '../rpg/dnd35/formulas'
import { targetGroups, targetLabel } from '../rpg/dnd35/targets'
import { useCms } from './context'
import { EntrySelect } from './EntrySelect'
import { EntityPick, ListPick, useSynced } from './fields'

const ROW_KINDS: PrerequisiteRow['kind'][] = ['entity', 'ability', 'bab', 'skill', 'classLevel', 'level', 'stat']

function newRow(kind: PrerequisiteRow['kind']): PrerequisiteRow {
  switch (kind) {
    case 'entity': return { kind, id: '' }
    case 'ability': return { kind, ability: 'str', min: 13 }
    case 'bab': return { kind, min: 1 }
    case 'skill': return { kind, skill: '', min: 5 }
    case 'classLevel': return { kind, classId: '', min: 1 }
    case 'level': return { kind, min: 1 }
    case 'stat': return { kind, key: '', min: 1 }
  }
}

function MinInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input className="input input-number" type="number" inputMode="numeric" min={0} value={value} aria-label={fr.cms.prerequisite.atLeast}
      onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} />
  )
}

/** A formula the cases can't say: shown as written, kept untouched; « Avancé » edits it. */
function AsWritten({ text }: { text: string }) {
  return <p className="field-hint">{fr.cms.asWritten} <code>{text}</code></p>
}

/** « Avoir Esquive et Dextérité ≥ 13 »: one row per condition, written `has('feat.dodge') and @ability.dex.score >= 13`. */
export function PrerequisiteField({ value, onChange }: { value: string; onChange: (formula: string | undefined) => void }) {
  const { skills, classes, names } = useCms()
  const parsed = parsePrerequisite(value)
  const [rows, setRows] = useSynced<string, PrerequisiteRow[]>(value, (v) => parsePrerequisite(v) ?? [], prerequisiteFormula)
  const emit = (next: PrerequisiteRow[]) => onChange(setRows(next) || undefined)
  const update = (i: number, row: PrerequisiteRow) => emit(rows.map((r, j) => (j === i ? row : r)))

  if (parsed == null) return <AsWritten text={value} />
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="cms-row">
          {i > 0 && <span className="cms-and">{fr.cms.and}</span>}
          <span className="cms-row-kind">{fr.cms.prerequisite.kinds[row.kind]}</span>
          <div className="cms-row-inputs">
            {row.kind === 'entity' && <EntityPick value={row.id} onChange={(id) => update(i, { ...row, id })} />}
            {row.kind === 'ability' && (
              <select className="input" value={row.ability} onChange={(e) => update(i, { ...row, ability: e.target.value as AbilityId })}>
                {abilities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {row.kind === 'skill' && <ListPick value={row.skill} options={skills} label={fr.cms.when.skill} onChange={(skill) => update(i, { ...row, skill })} />}
            {row.kind === 'classLevel' && <ListPick value={row.classId} options={classes} label={fr.cms.prerequisite.classLabel} onChange={(classId) => update(i, { ...row, classId })} />}
            {row.kind === 'stat' && (
              <EntrySelect type="statistic" value={row.key} label={fr.cms.prerequisite.kinds.stat} builtIn={targetGroups(skills)}
                nameOf={(key) => targetLabel(key, names)} onChange={(key) => update(i, { ...row, key })} />
            )}
            {row.kind !== 'entity' && (
              <>
                <span className="muted">≥</span>
                <MinInput value={row.min} onChange={(min) => update(i, { ...row, min })} />
              </>
            )}
            <button type="button" className="icon-button" aria-label={fr.cms.remove} onClick={() => emit(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        </div>
      ))}
      <div className="inline-add">
        <select className="input" value="" aria-label={fr.cms.prerequisite.add} onChange={(e) => e.target.value && emit([...rows, newRow(e.target.value as PrerequisiteRow['kind'])])}>
          <option value="">{fr.cms.add(fr.cms.prerequisite.add)}</option>
          {ROW_KINDS.map((k) => <option key={k} value={k}>{fr.cms.prerequisite.kinds[k]}</option>)}
        </select>
      </div>
    </>
  )
}

/** « 3 + Charisme + 1 tous les 4 niveaux de barde ». */
export function UsesField({ value, onChange }: { value: string | number | undefined; onChange: (value: string | number | undefined) => void }) {
  const { classes } = useCms()
  const parsed = parseUses(value)
  const [uses, setUses] = useSynced<string | number | undefined, UsesPerDay>(value, (v) => parseUses(v) ?? { base: 0 }, usesValue)
  const emit = (next: UsesPerDay) => onChange(setUses(next))

  if (parsed == null) return <AsWritten text={String(value)} />
  return (
    <>
      <div className="cms-row-inputs">
        <label className="field">
          <span className="cms-sublabel">{fr.cms.uses.base}</span>
          <MinInput value={uses.base} onChange={(base) => emit({ ...uses, base })} />
        </label>
        <label className="field">
          <span className="cms-sublabel">{fr.cms.uses.ability}</span>
          <select className="input" value={uses.ability ?? ''} onChange={(e) => emit({ ...uses, ability: (e.target.value || undefined) as AbilityId | undefined })}>
            <option value="">{fr.cms.uses.none}</option>
            {ABILITY_IDS.map((id) => <option key={id} value={id}>{abilities.find((a) => a.id === id)!.name}</option>)}
          </select>
        </label>
      </div>
      <div className="cms-row-inputs">
        <span className="cms-sublabel">{fr.cms.uses.perLevels}</span>
        <MinInput value={uses.perLevels?.every ?? 0}
          onChange={(every) => emit({ ...uses, perLevels: every > 0 ? { classId: uses.perLevels?.classId ?? '', every } : undefined })} />
        <span className="cms-sublabel">{fr.cms.uses.levelsOf}</span>
        <ListPick value={uses.perLevels?.classId ?? ''} options={classes} label={fr.cms.uses.noClass}
          onChange={(classId) => emit({ ...uses, perLevels: classId ? { classId, every: uses.perLevels?.every || 1 } : undefined })} />
      </div>
    </>
  )
}

const TABLE_MAXIMA = ['@bab', 'level()']

/** « Le joueur choisit une valeur à la table, au plus son BBA » (Attaque en puissance). */
export function TableValueField({ value, onChange }: { value: { max?: string | number } | undefined; onChange: (value: { max: string | number }) => void }) {
  const max = value?.max ?? '@bab'
  // Opening the field is the switch: it starts written, so the effects can offer « la valeur choisie » right away.
  useEffect(() => {
    if (value?.max == null) onChange({ max })
  }, [value?.max])
  const t = fr.cms.tableValue
  const kind = typeof max === 'number' ? 'number' : TABLE_MAXIMA.includes(max) ? max : 'other'
  return (
    <div className="cms-row-inputs">
      <span className="cms-sublabel">{t.atMost}</span>
      <select className="input" value={kind} onChange={(e) => onChange({ max: e.target.value === 'number' ? 5 : e.target.value })}>
        {TABLE_MAXIMA.map((m) => <option key={m} value={m}>{t.maxima[m]}</option>)}
        <option value="number">{t.number}</option>
        {kind === 'other' && <option value="other" disabled>{String(max)}</option>}
      </select>
      {typeof max === 'number' && (
        <input className="input input-number" type="number" min={1} value={max} aria-label={t.number}
          onChange={(e) => onChange({ max: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />
      )}
    </div>
  )
}

/** « À chaque prise : [ses effets s’ajoutent encore / il choisit une compétence…] ». Opening the field writes it. */
export function RepeatableField({ value, onChange }: { value: { choose?: ChoiceKind } | undefined; onChange: (value: { choose?: ChoiceKind }) => void }) {
  useEffect(() => {
    if (value == null) onChange({})
  }, [value])
  const t = fr.cms.repeatable
  return (
    <div className="cms-row-inputs">
      <span className="cms-sublabel">{t.label}</span>
      <select className="input" value={value?.choose ?? ''}
        onChange={(e) => onChange(e.target.value ? { choose: e.target.value as ChoiceKind } : {})}>
        {Object.entries(t.kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </div>
  )
}

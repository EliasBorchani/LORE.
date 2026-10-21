import { Fragment, useRef, useState, type ReactNode } from 'react'
import type { ChoiceKind, Effect, Entity, Localized } from '../api/types'
import { fr } from '../i18n/fr'
import { sourceId } from '../rpg/dnd35/sources'
import { issuesAt, useCms } from './context'
import { EffectsField } from './EffectsField'
import { Field, NameField } from './fields'
import { LabelsField } from './Labels'
import { EntrySelect } from './EntrySelect'
import { PrerequisiteField, RepeatableField, TableValueField, UsesField } from './RulesFields'
import { getAt, isEmpty, setAt, type FieldSpec, type FormSchema } from './schema'

/**
 * Renders a type's form: its sections, each field with what it is for. An optional field stays hidden while empty,
 * behind a « + Ajouter » chip, and « Retirer » empties and hides it again. « Avancé » shows the whole entry as JSON:
 * keys the form doesn't know stay in it, so nothing of the entity is ever dropped.
 */
export function FormEngine(props: {
  schema: FormSchema
  entity: Entity
  onChange: (entity: Entity) => void
  /** The entry replaced from « Avancé » (its id may change while creating). */
  onReplace: (entity: Entity) => void
  /** The id, shown under the name as it is built. */
  idField: ReactNode
  /** Blocks of the editor placed after the rules (a spell's levels). */
  extra?: ReactNode
}) {
  const { schema, entity, onChange } = props
  const { issues } = useCms()
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const record = entity as unknown as Record<string, unknown>
  // `repeatable: {}` says something: present is filled.
  const filled = (f: FieldSpec) => !isEmpty(getAt(record, f.key)) || (f.kind === 'repeatable' && getAt(record, f.key) != null)
  const visible = (f: FieldSpec) => !f.optional || opened.has(f.key) || filled(f)
  const open = (key: string) => setOpened((o) => new Set(o).add(key))
  const write = (key: string, value: unknown) => onChange(setAt(record, key, value) as unknown as Entity)
  const remove = (key: string) => {
    setOpened((o) => {
      const next = new Set(o)
      next.delete(key)
      return next
    })
    write(key, undefined)
  }
  const usesField = schema.sections.flatMap((s) => s.fields).find((f) => f.kind === 'usesPerDay')

  return (
    <>
      <p className="cms-intro">{schema.intro}</p>
      {schema.sections.map((section) => {
        const hidden = section.fields.filter((f) => !visible(f))
        return (
          <details key={section.id} className="cms-section" open>
            <summary>{section.title}</summary>
            <div className="cms-section-body">
              {section.fields.filter(visible).map((field) => (
                <Fragment key={field.key}>
                  <FieldView type={schema.type} field={field} value={getAt(record, field.key)} issues={issuesAt(issues, field.key)}
                    onChange={(value) => write(field.key, value)} onRemove={field.optional ? () => remove(field.key) : undefined}
                    onOpenUses={usesField && !visible(usesField) ? () => open(usesField.key) : undefined} />
                  {field.kind === 'name' && props.idField}
                </Fragment>
              ))}
              {hidden.length > 0 && (
                <div className="optional-chips">
                  {hidden.map((field) => (
                    <button key={field.key} type="button" className="chip chip-add" title={field.description} onClick={() => open(field.key)}>
                      {fr.cms.add(field.label)}
                    </button>
                  ))}
                </div>
              )}
              {section.id === 'rules' && props.extra}
            </div>
          </details>
        )
      })}
      <Advanced entity={entity} onReplace={props.onReplace} />
    </>
  )
}

function FieldView({ type, field, value, issues, onChange, onRemove, onOpenUses }: {
  type: string
  field: FieldSpec
  value: unknown
  issues: string[]
  onChange: (value: unknown) => void
  onRemove?: () => void
  onOpenUses?: () => void
}) {
  if (field.kind === 'name' || field.kind === 'description') {
    const missing = field.kind === 'name' && isEmpty(value) ? [fr.cms.nameMissing] : []
    return <NameField label={field.label} description={field.description} long={field.kind === 'description'} english={field.english}
      value={value as Localized | undefined} onChange={onChange} issues={[...missing, ...issues]} />
  }
  return (
    <Field label={field.label} description={field.description} issues={issues} onRemove={onRemove}>
      {field.kind === 'labels' && <LabelsField type={type} value={(value as string[] | undefined) ?? []} onChange={(l) => onChange(l.length ? l : undefined)} />}
      {field.kind === 'text' && <input className="input" value={(value as string | undefined) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />}
      {field.kind === 'source' && <SourceField value={(value as string | undefined) ?? ''} label={field.label} onChange={onChange} />}
      {field.kind === 'choice' && (
        <select className="input" value={String(value ?? '')} aria-label={field.label} onChange={(e) => {
          const picked = field.options!.find((o) => String(o.value) === e.target.value)
          onChange(picked == null || picked.value === '' ? undefined : picked.value)
        }}>
          {value != null && !field.options!.some((o) => o.value === value) && <option value={String(value)}>{String(value)}</option>}
          {field.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      )}
      {field.kind === 'flag' && (
        <label className="toggle-row">
          <span className="toggle-name">{field.label}</span>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />
        </label>
      )}
      {field.kind === 'repeatable' && <RepeatableField value={value as { choose?: ChoiceKind } | undefined} onChange={onChange} />}
      {field.kind === 'prerequisite' && <PrerequisiteField value={(value as string | undefined) ?? ''} onChange={onChange} />}
      {field.kind === 'tableValue' && <TableValueField value={value as { max?: string | number } | undefined} onChange={onChange} />}
      {field.kind === 'usesPerDay' && <UsesField value={value as string | number | undefined} onChange={onChange} />}
      {field.kind === 'effects' && <EffectsField value={(value as Effect[] | undefined) ?? []} onChange={onChange} onOpenUses={onOpenUses} />}
    </Field>
  )
}

/** The book, from the catalog's `source` entries; a name written as text before stays until replaced. */
function SourceField({ value, label, onChange }: { value: string; label: string; onChange: (value: string | undefined) => void }) {
  const { names } = useCms()
  const id = sourceId(value)
  return (
    <EntrySelect type="source" value={id} label={label} nameOf={() => names.get(id) ?? fr.cms.entries.asWritten(value)}
      onChange={(next) => onChange(next === id ? value : next || undefined)} />
  )
}

/**
 * The whole entry as JSON in a dialog: the form and the JSON are two views of one entry. « Appliquer » replaces the
 * entry, and every field, card and the live card follow.
 */
function Advanced({ entity, onReplace }: { entity: Entity; onReplace: (entity: Entity) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const open = () => {
    setText(JSON.stringify(entity, null, 2))
    setError(null)
    dialog.current?.showModal()
  }
  const apply = () => {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(fr.cms.json.notObject)
      const next = parsed as Entity
      if (typeof next.id !== 'string' || typeof next.type !== 'string') throw new Error(fr.cms.json.needsIdType)
      onReplace(next)
      dialog.current?.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="cms-advanced">
      <button type="button" className="btn btn-secondary btn-small" onClick={open}>{fr.cms.json.open}</button>
      <p className="field-hint">{fr.cms.advancedHint}</p>
      <dialog ref={dialog} className="json-dialog" aria-label={fr.cms.json.title}>
        <h2 className="type-heading">{fr.cms.json.title}</h2>
        <p className="field-hint">{fr.cms.json.hint}</p>
        <textarea className="input code json-text" spellCheck={false} value={text} aria-label={fr.cms.json.title}
          onChange={(e) => { setText(e.target.value); setError(null) }} />
        {error && <p className="warning" role="alert">{fr.cms.json.invalid(error)}</p>}
        <div className="button-row">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => dialog.current?.close()}>{fr.content.cancel}</button>
          <button type="button" className="btn btn-primary btn-small" onClick={apply}>{fr.cms.json.apply}</button>
        </div>
      </dialog>
    </div>
  )
}

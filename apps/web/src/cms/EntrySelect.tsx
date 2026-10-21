import { useRef, useState, type RefObject } from 'react'
import type { Localized } from '../api/types'
import { fr } from '../i18n/fr'
import type { TargetGroup } from '../rpg/dnd35/targets'
import { messageOf } from '../useLoad'
import { useCms } from './context'
import { groupEntries, type EntryType } from './entries'

const ADD = '+'

/**
 * One entry of a type the form refers to (a book, a statistic, a situation), from a dropdown: the RPG's built-in
 * choices first (`builtIn`), then the catalog's entries by ruleset, then « + Ajouter … à Maison », which creates the
 * entry in the ruleset of the entry being edited. A value no list knows stays selected, said by `nameOf`.
 */
export function EntrySelect({ type, value, onChange, label, builtIn = [], nameOf }: {
  type: EntryType
  value: string
  onChange: (id: string) => void
  label: string
  builtIn?: TargetGroup[]
  nameOf?: (id: string) => string
}) {
  const { entries, rulesets, createIn } = useCms()
  const dialog = useRef<HTMLDialogElement>(null)
  const t = fr.cms.entries
  const groups = [
    ...builtIn,
    ...groupEntries(entries[type], rulesets, { official: t.official, inRuleset: (r) => t.inRuleset(t.kinds[type], r) }),
  ]
  const known = groups.some((g) => g.options.some((o) => o.key === value))

  return (
    <>
      <select className="input" value={value} aria-label={label}
        onChange={(e) => (e.target.value === ADD ? dialog.current?.showModal() : onChange(e.target.value))}>
        <option value="">—</option>
        {value && !known && <option value={value}>{nameOf?.(value) ?? value}</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
        ))}
        {createIn && <option value={ADD}>{t.add[type](createIn.name)}</option>}
      </select>
      {createIn && <NewEntryDialog ref={dialog} type={type} onCreated={onChange} />}
    </>
  )
}

/** A name (a book: its English title) and « Créer »: the entry is published in the ruleset right away. */
function NewEntryDialog({ ref, type, onCreated }: { ref: RefObject<HTMLDialogElement | null>; type: EntryType; onCreated: (id: string) => void }) {
  const { createEntry } = useCms()
  const [name, setName] = useState<Localized>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = fr.cms.entries
  const englishOnly = type === 'source'
  const ready = Boolean((englishOnly ? name.en : name.fr || name.en)?.trim())
  const close = () => {
    ref.current?.close()
    setName({})
    setError(null)
  }
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const clean = Object.fromEntries(Object.entries(name).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v)) as Localized
      onCreated(await createEntry(type, clean))
      close()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog ref={ref} className="json-dialog entry-dialog" aria-label={t.title[type]} onClose={() => setError(null)}>
      <h2 className="type-heading">{t.title[type]}</h2>
      <p className="field-hint">{t.nameHint[type]}</p>
      {englishOnly ? (
        <label className="field">
          <span className="cms-sublabel">{t.title_en}</span>
          <input className="input" lang="en" value={name.en ?? ''} onChange={(e) => setName({ en: e.target.value })} />
        </label>
      ) : (
        <>
          <label className="field">
            <span className="cms-sublabel">{t.name}</span>
            <input className="input" lang="fr" value={name.fr ?? ''} onChange={(e) => setName({ ...name, fr: e.target.value })} />
          </label>
          <label className="field">
            <span className="cms-sublabel">{fr.cms.nameEn}</span>
            <input className="input" lang="en" value={name.en ?? ''} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </label>
        </>
      )}
      {error && <p className="warning" role="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="btn btn-secondary btn-small" onClick={close}>{fr.content.cancel}</button>
        <button type="button" className="btn btn-primary btn-small" disabled={!ready || busy} onClick={() => void create()}>
          {busy ? t.creating : t.create}
        </button>
      </div>
    </dialog>
  )
}

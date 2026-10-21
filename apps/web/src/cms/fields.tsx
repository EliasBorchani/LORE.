import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Localized } from '../api/types'
import { normalize } from '../components/Picker'
import { fr } from '../i18n/fr'
import { localized } from '../sheet/names'
import { useCms } from './context'

/** A field's frame: its name, what it is for, its problems, and « Retirer » when it is optional. */
export function Field(props: { label: string; description?: string; issues?: string[]; onRemove?: () => void; children: ReactNode }) {
  return (
    <div className="cms-field">
      <div className="cms-field-head">
        <span className="cms-label">{props.label}</span>
        {props.onRemove && (
          <button type="button" className="link-button" onClick={props.onRemove}>{fr.cms.remove}</button>
        )}
      </div>
      {props.description && <p className="field-hint">{props.description}</p>}
      {props.children}
      {props.issues?.map((issue) => <p key={issue} className="warning" role="alert">{issue}</p>)}
    </div>
  )
}

/**
 * A local model of a value the parent owns (effect blocks, prerequisite rows): edits stay local while they don't
 * change the value (an empty row), and a change from outside (a draft taken back) resets the model.
 */
export function useSynced<V, M>(value: V, parse: (value: V) => M, build: (model: M) => V): [M, (model: M) => V] {
  const [model, setModel] = useState(() => parse(value))
  const last = useRef(JSON.stringify(value))
  useEffect(() => {
    const text = JSON.stringify(value)
    if (text !== last.current && text !== JSON.stringify(build(model))) setModel(parse(value))
    last.current = text
  }, [value])
  const update = (next: M) => {
    setModel(next)
    const built = build(next)
    last.current = JSON.stringify(built)
    return built
  }
  return [model, update]
}

/** French first; English opens as a translation. One of the two is enough. */
export function NameField({ value, onChange, long, english, label, description, issues }: {
  value: Localized | undefined
  onChange: (value: Localized | undefined) => void
  long?: boolean
  /** One English text only (a book's title). */
  english?: boolean
  label: string
  description: string
  issues?: string[]
}) {
  const [showEn, setShowEn] = useState(Boolean(value?.en))
  const set = (lang: 'fr' | 'en', text: string) => {
    const next: Localized = { ...value, [lang]: text }
    if (!text.trim()) delete next[lang]
    onChange(Object.keys(next).length ? next : undefined)
  }
  const Input = long ? 'textarea' : 'input'
  if (english) {
    return (
      <Field label={label} description={description} issues={issues}>
        <Input className="input" value={value?.en ?? ''} onChange={(e) => set('en', e.target.value)} lang="en" autoComplete="off" />
      </Field>
    )
  }
  return (
    <Field label={label} description={description} issues={issues}>
      <Input className="input" value={value?.fr ?? ''} onChange={(e) => set('fr', e.target.value)} lang="fr" autoComplete="off" />
      {showEn ? (
        <label className="field">
          <span className="cms-sublabel">{long ? fr.cms.descriptionEn : fr.cms.nameEn}</span>
          <Input className="input" value={value?.en ?? ''} onChange={(e) => set('en', e.target.value)} lang="en" autoComplete="off" />
          {!long && <span className="field-hint">{fr.cms.translationHint}</span>}
        </label>
      ) : (
        <div><button type="button" className="chip chip-add" onClick={() => setShowEn(true)}>{fr.cms.add(fr.cms.translation)}</button></div>
      )}
    </Field>
  )
}

const SEARCH_DELAY_MS = 250

/**
 * One entity, found by name through the group's search (the catalog can hold tens of thousands): shows the chosen
 * one, « Changer » searches again. `type` narrows the search.
 */
export function EntityPick({ value, onChange, type, label }: { value: string; onChange: (id: string) => void; type?: string; label?: string }) {
  const { groupApi, names, addName } = useCms()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string; type: string }[]>([])
  const [open, setOpen] = useState(!value)

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      groupApi.search({ q: query, type, limit: 12 }).then(
        (page) => current && setResults(page.items.map((i) => ({ id: i.id, type: i.type, name: localized(i.name) ?? i.id }))),
        () => current && setResults([]),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query, open, type])

  if (!open) {
    return (
      <span className="entity-chosen">
        <strong>{names.get(value) ?? value}</strong>
        <button type="button" className="link-button" onClick={() => setOpen(true)}>{fr.cms.change}</button>
      </span>
    )
  }
  return (
    <div className="entity-pick">
      <input className="input" type="search" value={query} placeholder={label ?? fr.cms.pick} aria-label={label ?? fr.cms.pick}
        onChange={(e) => setQuery(e.target.value)} autoFocus={!!value} />
      {results.length > 0 && (
        <ul className="pick-results">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { addName(r.id, r.name); onChange(r.id); setOpen(false); setQuery('') }}>
                {r.name} <span className="muted">· {r.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length < 2 && <span className="field-hint">{fr.cms.pickHint}</span>}
    </div>
  )
}

/** A short list (skills, classes) to pick from, filtered by typing. */
export function ListPick({ value, options, onChange, label }: { value: string; options: { key: string; label: string }[]; onChange: (key: string) => void; label: string }) {
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {value && !options.some((o) => o.key === value) && <option value={value}>{value}</option>}
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}

/** Several of a long list (skills): chips for the chosen ones and the `suggested` ones, a filter to find more. */
export function MultiPick({ value, options, onChange, searchLabel, suggested = [] }: {
  value: string[]
  options: { key: string; label: string }[]
  onChange: (keys: string[]) => void
  searchLabel: string
  suggested?: { key: string; label: string }[]
}) {
  const [query, setQuery] = useState('')
  const q = normalize(query.trim())
  const label = (key: string) => [...suggested, ...options].find((o) => o.key === key)?.label ?? key
  const offered = suggested.filter((o) => !value.includes(o.key))
  const found = q ? options.filter((o) => !value.includes(o.key) && normalize(o.label).includes(q)).slice(0, 8) : []
  return (
    <>
      <div className="chips">
        {value.map((key) => (
          <button key={key} type="button" className="chip" aria-pressed="true" onClick={() => onChange(value.filter((k) => k !== key))}>
            {label(key)} ×
          </button>
        ))}
        {offered.map((o) => (
          <button key={o.key} type="button" className="chip" onClick={() => onChange([...value, o.key])}>+ {o.label}</button>
        ))}
      </div>
      <input className="input" type="search" value={query} placeholder={searchLabel} aria-label={searchLabel} onChange={(e) => setQuery(e.target.value)} />
      {found.length > 0 && (
        <div className="chips">
          {found.map((o) => (
            <button key={o.key} type="button" className="chip" onClick={() => { onChange([...value, o.key]); setQuery('') }}>+ {o.label}</button>
          ))}
        </div>
      )}
    </>
  )
}

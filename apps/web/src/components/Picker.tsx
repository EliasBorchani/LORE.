import { useState } from 'react'
import { fr } from '../i18n/fr'
import { InfoButton } from './EntityPanel'

export interface PickerItem {
  id: string
  name: string
  sub?: string
}

const MAX_SHOWN = 30

/** Accents and case do not count when searching (« epee » finds « Épée »). */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** A searchable list: type part of a name or keyword, tap a row to pick it, ⓘ to read it first. */
export function Picker({ items, onPick, label = fr.editor.search }: { items: PickerItem[]; onPick: (id: string) => void; label?: string }) {
  const [query, setQuery] = useState('')
  const q = normalize(query.trim())
  const matches = q ? items.filter((i) => normalize(`${i.name} ${i.sub ?? ''}`).includes(q)) : items
  const shown = matches.slice(0, MAX_SHOWN)
  return (
    <div className="picker">
      <label className="field">
        <span>{label}</span>
        <input className="input" type="search" value={query} placeholder={fr.editor.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="list">
        {shown.map((item) => (
          <div key={item.id} className="picker-line">
            <button type="button" className="list-row picker-row" onClick={() => onPick(item.id)}>
              <span className="list-row-text">
                <span>{item.name}</span>
                {item.sub && <span className="list-row-sub">{item.sub}</span>}
              </span>
            </button>
            <InfoButton id={item.id} name={item.name} />
          </div>
        ))}
        {shown.length === 0 && <p className="muted">{fr.editor.noResult}</p>}
      </div>
      {matches.length > MAX_SHOWN && <p className="muted">{fr.editor.more(matches.length - MAX_SHOWN)}</p>}
    </div>
  )
}

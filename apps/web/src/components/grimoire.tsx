// The Grimoire design system's components (artifact 1NjhDKFEebfSVM9JpCSjDZ), as React components.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { fr } from '../i18n/fr'

/** Where content comes from: a house rule or another entity of a ruleset (by name), else its provenance. */
export function Badge({ provenance, ruleset, houseRule }: { provenance?: string; ruleset?: string; houseRule?: boolean }) {
  if (houseRule) return <span className="badge badge-team">{fr.catalog.houseRule}</span>
  if (ruleset) return <span className="badge badge-team">{ruleset}</span>
  if (!provenance) return null
  return provenance === 'official' ? (
    <span className="badge badge-official">{fr.catalog.official}</span>
  ) : (
    <span className="badge badge-team">{fr.catalog.team}</span>
  )
}

/** The rulebook block: a garnet title between two red rules. */
export function StatBlock(props: { title: ReactNode; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section className="block" aria-label={props.label}>
      <div className="block-head">
        <h2 className="block-title">{props.title}</h2>
        {props.aside}
      </div>
      {props.subtitle && <span className="block-sub">{props.subtitle}</span>}
      <div className="block-sep" />
      {props.children}
    </section>
  )
}

/** One number and its label; a link to its breakdown when [to] is given. */
export function StatTile({ value, label, extra, to }: { value: string; label: string; extra?: string; to?: string }) {
  const content = (
    <>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
      {extra && <span className="tile-extra">{extra}</span>}
    </>
  )
  return to ? (
    <Link className="tile" to={to} aria-label={fr.sheet.seeBreakdown(`${label} ${value}`)}>
      {content}
    </Link>
  ) : (
    <div className="tile">{content}</div>
  )
}

export function ToggleRow(props: {
  name: string
  meta: string
  on: boolean
  onChange: (on: boolean) => void
  /** After the checkbox: a button there does not switch the toggle. */
  info?: ReactNode
  children?: ReactNode
}) {
  return (
    <div>
      <label className={`toggle-row${props.on ? ' on' : ''}`}>
        <span className="toggle-text">
          <span className="toggle-name">{props.name}</span>
          <span className="toggle-meta">{props.meta}</span>
        </span>
        <input type="checkbox" checked={props.on} onChange={(e) => props.onChange(e.target.checked)} />
        {props.info}
      </label>
      {props.children}
    </div>
  )
}

export function BreakdownRow(props: { source: string; detail: string; value: string; out: boolean; to?: string; onOpen?: () => void }) {
  const content = (
    <>
      <span className="breakdown-src">
        <span className="s">{props.source}</span>
        {props.detail && <span className="d">{props.detail}</span>}
      </span>
      <span className="v">{props.value}</span>
    </>
  )
  const className = `breakdown-row${props.out ? ' out' : ''}`
  if (props.onOpen) return <button type="button" className={className} onClick={props.onOpen}>{content}</button>
  return props.to ? (
    <Link className={className} to={props.to}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  )
}

export function Icon({ name }: { name: 'back' | 'chevron' | 'person' | 'people' | 'book' | 'gear' | 'check' | 'plus' | 'info' | 'close' | 'quill' }) {
  const paths: Record<typeof name, ReactNode> = {
    back: <path d="m15 18-6-6 6-6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    people: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><circle cx="17" cy="7" r="3" /><path d="M17.5 13a6 6 0 0 1 4.5 6" /></>,
    book: <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5zM8 7h7" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    quill: <><path d="M20 4C12 4 7 9 5 19l2 1c1-3 2.5-5 4.5-6.5L15 14c3-2 5-5.5 5-10z" /><path d="M5 19 3 21" /></>,
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function Loading() {
  return <p className="muted" role="status">{fr.loading}</p>
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice warning" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-small" onClick={onRetry}>
          {fr.errors.retry}
        </button>
      )}
    </div>
  )
}

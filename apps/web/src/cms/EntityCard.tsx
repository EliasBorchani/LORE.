import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Mark } from '../components/Mark'
import type { CardModel } from '../rpg/dnd35/cards'

/**
 * One catalog result: a band in the entry's colour with its mark, then the kicker, the name, the facts its type
 * chose (`rpg/dnd35/cards.ts`) and a line of text. Without `to` it is not a link (the editor's preview).
 */
export function EntityCard({ model, title, to, aside, note }: { model: CardModel; title: string; to?: string; aside?: ReactNode; note?: string }) {
  const body = (
    <>
      <span className="entity-card-band" data-colour={model.accent}>
        <Mark drawing={model.mark} size={28} />
      </span>
      <span className="entity-card-body">
        {model.kicker && <span className="entity-card-kicker">{model.kicker}</span>}
        <span className="entity-card-head">
          <span className="entity-card-title">{title}</span>
          {aside}
          {model.big && (
            <span className="entity-card-big" title={model.big.label} data-colour={model.accent}>
              <span className="visually-hidden">{model.big.label} : </span>{model.big.value}
            </span>
          )}
        </span>
        {model.facts.length > 0 && (
          <span className="entity-card-facts">
            {model.facts.map((f) => (
              <span key={f.label} className="fact-chip">
                <span className="fact-chip-label">{f.label}</span> {f.value}
              </span>
            ))}
          </span>
        )}
        {model.effects && <span className="entity-card-effects">{model.effects}</span>}
        {model.blurb && <span className="entity-card-blurb">{model.blurb}</span>}
        {note && <span className="entity-card-note">{note}</span>}
      </span>
    </>
  )
  return to ? <Link className="entity-card" to={to}>{body}</Link> : <div className="entity-card">{body}</div>
}

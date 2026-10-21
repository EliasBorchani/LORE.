import { Mark } from '../components/Mark'
import { labelFor, labelsForType, shownLabels, type Label } from '../rpg/dnd35/labels'

/** One label as a chip: its icon in the family colour, then its name. An unknown label shows as stored. */
export function LabelTag({ label }: { label: Label | string }) {
  if (typeof label === 'string') return <span className="tag">{label.replaceAll('_', ' ')}</span>
  return (
    <span className="tag tag-label" data-colour={label.colour}>
      <Mark drawing={label.icon} size={16} />
      {label.fr}
    </span>
  )
}

/** An entry's labels, without the ones that only repeat its type. */
export function LabelTags({ type, labels }: { type: string; labels: string[] }) {
  const shown = shownLabels(type, labels)
  if (shown.length === 0) return null
  return <div className="tags">{shown.map((l) => <LabelTag key={typeof l === 'string' ? l : l.id} label={l} />)}</div>
}

/** The curated labels of the entry's type as chips; a stored label outside that list stays shown and can be removed. */
export function LabelsField({ type, value, onChange }: { type: string; value: string[]; onChange: (labels: string[]) => void }) {
  const offered = labelsForType(type)
  const others = value.filter((stored) => !offered.some((l) => l.id === (labelFor(stored)?.id ?? stored)))
  const has = (id: string) => value.some((stored) => (labelFor(stored)?.id ?? stored) === id)
  const toggle = (id: string) =>
    onChange(has(id) ? value.filter((stored) => (labelFor(stored)?.id ?? stored) !== id) : [...value, id])
  return (
    <div className="chips">
      {offered.map((label) => (
        <button key={label.id} type="button" className="chip chip-label" data-colour={label.colour} aria-pressed={has(label.id)}
          onClick={() => toggle(label.id)}>
          <Mark drawing={label.icon} size={16} />
          {label.fr}
        </button>
      ))}
      {others.map((stored) => {
        const known = labelFor(stored)
        return (
          <button key={stored} type="button" className="chip chip-label" data-colour={known?.colour} aria-pressed onClick={() => toggle(known?.id ?? stored)}>
            {known && <Mark drawing={known.icon} size={16} />}
            {known?.fr ?? stored.replaceAll('_', ' ')}
          </button>
        )
      })}
    </div>
  )
}

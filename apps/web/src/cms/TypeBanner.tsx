import { Mark } from '../components/Mark'
import { TYPE_ICONS } from '../rpg/dnd35/icons'

/** A decorative band for a type: its colour and mark, until real illustrations come (docs/prd-cms.md). */
export function TypeBanner({ type, size = 'large' }: { type: string; size?: 'large' | 'small' }) {
  return (
    <div className={`type-banner type-banner-${size}`} data-type={type} aria-hidden="true">
      <Mark drawing={TYPE_ICONS[type] ?? TYPE_ICONS.source} size={size === 'large' ? 72 : 44} />
    </div>
  )
}

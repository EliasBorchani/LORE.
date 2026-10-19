import { Link } from 'react-router'
import { fr } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'

/** Feats and entities gained, level by level, each opening its catalog page. */
export function FeatsTab() {
  const { record, name } = useSheet()
  const rows = (record.character.levels ?? []).flatMap((level) =>
    [...(level.feats ?? []).map((f) => f.id), ...(level.gained ?? [])].map((id) => ({ id, level: level.level })),
  )
  if (rows.length === 0) return <p className="muted">{fr.sheet.noFeats}</p>
  return (
    <div className="list">
      {rows.map((row) => (
        <Link key={`${row.level}-${row.id}`} className="list-row" to={`/catalog/entity/${row.id}`}>
          <span className="list-row-text">
            <span className="list-row-title">{name(row.id)}</span>
            <span className="list-row-sub">
              {fr.home.level} {row.level}
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}

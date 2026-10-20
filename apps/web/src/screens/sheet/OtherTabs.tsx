import { useEntityInfo } from '../../components/EntityPanel'
import { fr } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'

/** Feats and entities gained, level by level, each opening its info panel. */
export function FeatsTab() {
  const { record, name } = useSheet()
  const open = useEntityInfo()
  const rows = (record.character.levels ?? []).flatMap((level) =>
    [...(level.feats ?? []).map((f) => f.id), ...(level.gained ?? [])].map((id) => ({ id, level: level.level })),
  )
  if (rows.length === 0) return <p className="muted">{fr.sheet.noFeats}</p>
  return (
    <div className="list">
      {rows.map((row) => (
        <button type="button" key={`${row.level}-${row.id}`} className="list-row picker-row" onClick={() => open(row.id)}>
          <span className="list-row-text">
            <span className="list-row-title">{name(row.id)}</span>
            <span className="list-row-sub">
              {fr.home.level} {row.level}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

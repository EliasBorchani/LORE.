import { Link } from 'react-router'
import type { Closure, ProgressionRow } from '../api/types'
import { ErrorNotice, Loading } from '../components/grimoire'
import { formatModifier } from '../format'
import { fr } from '../i18n/fr'
import { entityName } from '../sheet/names'
import { useLoad } from '../useLoad'
import { useGroupApi, useGroupPath } from '../group/GroupContext'

export const CLASS_TYPES = ['class', 'prestige_class']

/**
 * A class's table (base attack, saves, features by level) and what its relations point to (class skills,
 * proficiencies, alignments). Both come from the class's closure, which also carries the names to show.
 */
export function ClassProgression({ classId, className }: { classId: string; className: string }) {
  const groupApi = useGroupApi()
  const { data, error, reload } = useLoad(() => groupApi.closure([classId]), classId)
  if (error) return <ErrorNotice message={error} onRetry={reload} />
  if (!data) return <Loading />

  const rows = (data.catalog.progressions ?? [])
    .filter((r) => r.classId === classId)
    .sort((a, b) => a.level - b.level)
  const name = (id: string) => entityName(data.catalog.entities.find((e) => e.id === id), id)

  return (
    <>
      {rows.length > 0 && <ProgressionTable rows={rows} caption={fr.catalog.tableCaption(className)} name={name} />}
      <SpellTable rows={rows} column="spellsPerDay" title={fr.catalog.spellsPerDay} />
      <SpellTable rows={rows} column="spellsKnown" title={fr.catalog.spellsKnown} />
      <Related closure={data} classId={classId} name={name} />
    </>
  )
}

function ProgressionTable({ rows, caption, name }: { rows: ProgressionRow[]; caption: string; name: (id: string) => string }) {
  const groupPath = useGroupPath()
  const c = fr.catalog.tableColumns
  return (
    <section className="page-head">
      <h2 className="type-heading">{fr.catalog.table}</h2>
      <div className="table-scroll block class-table-wrap">
        <table className="class-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{c.level}</th>
              <th scope="col">{c.bab}</th>
              <th scope="col">{c.ref}</th>
              <th scope="col">{c.fort}</th>
              <th scope="col">{c.will}</th>
              <th scope="col" className="special">{c.special}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.level}>
                <th scope="row">{row.level}</th>
                <td>{iterativeAttacks(row.bab)}</td>
                <td>{save(row.ref)}</td>
                <td>{save(row.fort)}</td>
                <td>{save(row.will)}</td>
                <td className="special">
                  {(row.grants ?? []).map((id, i) => (
                    <span key={id}>
                      {i > 0 && ', '}
                      <Link to={groupPath(`/catalog/entity/${id}`)}>{name(id)}</Link>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Spells per day or spells known by class level, one column per spell level; « — » where the class cannot cast. */
function SpellTable({ rows, column, title }: { rows: ProgressionRow[]; column: 'spellsPerDay' | 'spellsKnown'; title: string }) {
  const written = rows.filter((r) => (r[column] ?? []).length > 0)
  if (written.length === 0) return null
  const width = Math.max(...written.map((r) => r[column]!.length))
  return (
    <section className="page-head">
      <h2 className="type-heading">{title}</h2>
      <div className="table-scroll block class-table-wrap">
        <table className="class-table">
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{fr.catalog.tableColumns.level}</th>
              {Array.from({ length: width }, (_, level) => <th key={level} scope="col">{level}</th>)}
            </tr>
          </thead>
          <tbody>
            {written.map((row) => (
              <tr key={row.level}>
                <th scope="row">{row.level}</th>
                {Array.from({ length: width }, (_, level) => <td key={level}>{row[column]![level] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Related({ closure, classId, name }: { closure: Closure; classId: string; name: (id: string) => string }) {
  const groupPath = useGroupPath()
  const relations = (closure.catalog.relations ?? []).filter((r) => r.from === classId)
  const groups = Object.entries(fr.catalog.related)
    .map(([kind, label]) => ({ label, ids: relations.filter((r) => r.relation === kind).map((r) => r.to) }))
    .filter((g) => g.ids.length > 0)
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="page-head">
          <h2 className="type-heading">{g.label}</h2>
          <div className="tags">
            {g.ids
              .map((id) => ({ id, label: name(id) }))
              .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
              .map((t) => (
                <Link key={t.id} className="tag" to={groupPath(`/catalog/entity/${t.id}`)}>
                  {t.label}
                </Link>
              ))}
          </div>
        </section>
      ))}
    </>
  )
}

/** Rows hold exact running totals; the table shows whole numbers, as the books do. */
const whole = (value: number | string | undefined) => Math.floor(Number(value ?? 0))

const save = (value: number | string | undefined) => formatModifier(String(whole(value)))

/** `+16/+11/+6/+1`: an extra attack at −5 while the bonus stays above 0, four attacks at most. */
export function iterativeAttacks(value: number | string | undefined): string {
  const bab = whole(value)
  const attacks = [bab]
  while (attacks.length < 4 && attacks[attacks.length - 1] - 5 > 0) attacks.push(attacks[attacks.length - 1] - 5)
  return attacks.map((a) => formatModifier(String(a))).join('/')
}

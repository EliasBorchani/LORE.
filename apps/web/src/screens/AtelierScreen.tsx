import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { SearchItem } from '../api/types'
import { TypeBanner } from '../cms/TypeBanner'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { useGroup } from '../group/GroupContext'
import { entityTypes, fr, typeName } from '../i18n/fr'
import { GUIDED_TYPES } from '../rpg/dnd35/forms'
import { localized } from '../sheet/names'
import { messageOf, useLoad } from '../useLoad'

/** The types shown first, as cards; the others sit in a list below. */
const MAIN_TYPES = ['feat', 'class_power', 'spell', 'maneuver', 'stance', 'item', 'class', 'prestige_class', 'race', 'skill']
const SEARCH_DELAY_MS = 250

/**
 * The group's workshop (docs/prd-cms.md): create an entry from a type card or from an existing one, take back a
 * draft, see what changed lately in the group's rulesets.
 */
export function AtelierScreen() {
  const { group, path } = useGroup()
  const canCreate = group.rulesets.some((r) => r.editable && !r.archived)

  return (
    <>
      <header className="page-head">
        <h1 className="type-display-l">{fr.atelier.title}</h1>
        <p className="type-body-l muted">{fr.atelier.intro}</p>
      </header>
      {!canCreate && (
        <div className="notice">
          <p>{fr.atelier.noRights}</p>
          <Link className="btn btn-secondary btn-small" to={path('/settings')}>{fr.groups.settings}</Link>
        </div>
      )}

      <section className="page-head">
        <h2 className="type-heading">{fr.atelier.create}</h2>
        <div className="type-cards">
          {MAIN_TYPES.map((type) => {
            const info = entityTypes.find((t) => t.type === type)
            return (
              <Link key={type} className="type-card" to={path(`/catalog/new?type=${type}`)} aria-disabled={!canCreate}>
                <TypeBanner type={type} size="small" />
                <span className="type-card-text">
                  <strong>{typeName(type)}</strong>
                  <span className="muted">{info?.hint}</span>
                </span>
                {GUIDED_TYPES.includes(type) && <span className="badge badge-team">{fr.atelier.guided}</span>}
              </Link>
            )
          })}
        </div>
        <details>
          <summary className="link-button">{fr.atelier.others}</summary>
          <div className="chips">
            {entityTypes.filter((t) => !MAIN_TYPES.includes(t.type)).map((t) => (
              <Link key={t.type} className="chip" to={path(`/catalog/new?type=${t.type}`)}>{t.name}</Link>
            ))}
          </div>
        </details>
      </section>

      <FromExisting />
      <Drafts />
      <Changes />
    </>
  )
}

function FromExisting() {
  const { catalog, path } = useGroup()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[]>([])
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      catalog.search({ q: query, limit: 8 }).then((page) => current && setResults(page.items), () => current && setResults([]))
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  return (
    <StatBlock title={fr.atelier.fromExisting} subtitle={fr.atelier.fromExistingHint}>
      <input className="input" type="search" value={query} placeholder={fr.cms.pick} aria-label={fr.atelier.fromExisting} onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 && (
        <div className="list">
          {results.map((item) => (
            <button key={item.id} type="button" className="list-row picker-row" onClick={() => navigate(path(`/catalog/new?copy=${encodeURIComponent(item.id)}`))}>
              <span className="list-row-text">
                <span className="list-row-title">{localized(item.name) ?? item.id}</span>
                <span className="list-row-sub">{typeName(item.type)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </StatBlock>
  )
}

function Drafts() {
  const { catalog, path } = useGroup()
  const { data, error, reload } = useLoad(catalog.drafts, `drafts/${catalog.groupId}`)
  const [asked, setAsked] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const remove = (id: string) => catalog.deleteDraft(id).then(() => { setAsked(null); reload() }, (e) => setFailed(messageOf(e)))

  return (
    <StatBlock title={fr.atelier.drafts}>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && <p className="muted">{fr.atelier.noDrafts}</p>}
      {failed && <p className="warning">{failed}</p>}
      {data?.map((d) => (
        <div key={d.id} className="list-row">
          <Link className="list-row-text" to={path(`/atelier/draft/${d.id}`)}>
            <span className="list-row-title">{localized(d.name) ?? fr.atelier.untitled}</span>
            <span className="list-row-sub">{d.type ? typeName(d.type) : ''} · {new Date(d.updatedAt).toLocaleString('fr')}</span>
          </Link>
          {asked === d.id ? (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void remove(d.id)}>{fr.atelier.confirmDelete}</button>
          ) : (
            <button type="button" className="link-button" onClick={() => setAsked(d.id)}>{fr.atelier.deleteDraft}</button>
          )}
        </div>
      ))}
    </StatBlock>
  )
}

function Changes() {
  const { catalog, path } = useGroup()
  const { data, error, reload } = useLoad(catalog.changes, `changes/${catalog.groupId}`)
  return (
    <StatBlock title={fr.atelier.changes}>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && <p className="muted">{fr.atelier.noChanges}</p>}
      {data?.map((c) => (
        <Link key={`${c.id}-${c.version}`} className="list-row" to={path(`/catalog/entity/${encodeURIComponent(c.overrides ?? c.id)}`)}>
          <span className="list-row-text">
            <span className="list-row-title">{localized(c.name) ?? c.id}</span>
            <span className="list-row-sub">
              {typeName(c.type)} · {fr.atelier.changeBy(c.author, new Date(c.createdAt).toLocaleDateString('fr'))}{c.note ? ` · ${c.note}` : ''}
            </span>
          </span>
        </Link>
      ))}
    </StatBlock>
  )
}

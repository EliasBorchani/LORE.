import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../api/client'
import { FACETS, type Effect, type EntitySummary, type Facet, type FacetValue, type SearchFilters, type SearchItem, type SearchPage } from '../api/types'
import { Badge, ErrorNotice, Icon, Loading, StatBlock } from '../components/grimoire'
import { formatNumber } from '../format'
import { affectsNames, entityTypes, fr, typeName } from '../i18n/fr'
import { entityName, localized } from '../sheet/names'
import { messageOf, useLoad } from '../useLoad'
import { CLASS_TYPES, ClassProgression } from './ClassProgression'

const SEARCH_DELAY_MS = 250
/** Values shown per filter before « Voir tout ». */
const FACET_SHOWN = 12

interface SearchState {
  text: string
  setText: (text: string) => void
  filters: SearchFilters
  /** Changes when the filters do: `filters` itself is a new object on every render. */
  filtersKey: string
  activeFilters: number
  toggle: (facet: Facet, value: string) => void
  clear: () => void
}

/**
 * The search text and filters are copied to the address (`?q=…&level=8`), so coming back from an entity shows the same
 * results. The input reads its own state: the address updates asynchronously, and reading it back would drop fast
 * keystrokes. Filters change on a tap and are read from the address.
 */
function useSearchState(): SearchState {
  const [params, setParams] = useSearchParams()
  const fromAddress = params.get('q') ?? ''
  const [text, setLocal] = useState(fromAddress)
  const seen = useRef(fromAddress)
  // Values typed here and not yet in the address: they reach it later, one by one.
  const pending = useRef<string[]>([])
  if (fromAddress !== seen.current) {
    seen.current = fromAddress
    const ours = pending.current.indexOf(fromAddress)
    if (ours >= 0) {
      pending.current = pending.current.slice(ours + 1)
    } else {
      // A change from elsewhere (the « Catalogue » link, back and forward) wins over the field.
      pending.current = []
      setLocal(fromAddress)
    }
  }
  const update = (change: (next: URLSearchParams) => void) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      change(next)
      return next
    }, { replace: true })
  const setText = (value: string) => {
    pending.current.push(value)
    setLocal(value)
    update((next) => (value ? next.set('q', value) : next.delete('q')))
  }
  const filters: SearchFilters = {}
  for (const facet of FACETS) {
    const values = (params.get(facet) ?? '').split(',').filter(Boolean)
    if (values.length) filters[facet] = values
  }
  const toggle = (facet: Facet, value: string) =>
    update((next) => {
      const values = (next.get(facet) ?? '').split(',').filter(Boolean)
      const changed = values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
      if (changed.length) next.set(facet, changed.join(','))
      else next.delete(facet)
    })
  const clear = () => update((next) => FACETS.forEach((facet) => next.delete(facet)))
  return {
    text,
    setText,
    filters,
    filtersKey: FACETS.map((facet) => filters[facet]?.join(',') ?? '').join('|'),
    activeFilters: Object.values(filters).reduce((n, values) => n + values.length, 0),
    toggle,
    clear,
  }
}

function SearchField({ text, onChange, label, placeholder }: { text: string; onChange: (text: string) => void; label: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="search" value={text} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/**
 * Server search, sent once typing pauses; an answer to an older query is dropped. The first page also brings the count
 * of each filter value, shown in the filter panel when `showFilters`.
 */
function SearchResults({ search, type, showFilters }: { search: SearchState; type?: string; showFilters?: boolean }) {
  const q = search.text.trim()
  const { filters, filtersKey } = search
  const [items, setItems] = useState<SearchItem[]>([])
  const [facets, setFacets] = useState<SearchPage['facets']>()
  const [next, setNext] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const queryKey = `${q}|${type}|${filtersKey}`
  const latest = useRef(queryKey)
  latest.current = queryKey

  // `filters` is read through `filtersKey`, which changes with it.
  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      api.search({ q, type, filters, facets: true }).then(
        (page) => {
          if (!current) return
          setItems(page.items)
          setFacets(page.facets)
          setNext(page.next)
          setLoading(false)
        },
        (e) => {
          if (!current) return
          setError(messageOf(e))
          setLoading(false)
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q, type, filtersKey, attempt])

  const more = (offset: number) => {
    setLoading(true)
    api.search({ q, type, filters, offset }).then(
      (page) => {
        if (latest.current !== queryKey) return
        setItems((shown) => [...shown, ...page.items])
        setNext(page.next)
        setLoading(false)
      },
      (e) => {
        if (latest.current !== queryKey) return
        setError(messageOf(e))
        setLoading(false)
      },
    )
  }

  return (
    <>
      {showFilters && facets && <FilterPanel facets={facets} search={search} />}
      {error && <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {items.length > 0 && (
        <div className="list">
          {items.map((e) => {
            const sub = [!type && typeName(e.type), e.matchedIn === 'description' && fr.catalog.inDescription].filter(Boolean).join(' · ')
            return (
              <Link key={e.id} className="list-row" to={`/catalog/entity/${e.id}`}>
                <span className="list-row-text">
                  <span className="list-row-title">{localized(e.name) ?? e.id}</span>
                  {sub && <span className="list-row-sub">{sub}</span>}
                </span>
                <Icon name="chevron" />
              </Link>
            )
          })}
        </div>
      )}
      {!loading && !error && items.length === 0 && <p className="muted">{fr.catalog.noResult}</p>}
      {loading && <Loading />}
      {next != null && !loading && (
        <button className="btn btn-secondary" onClick={() => more(next)}>
          {fr.catalog.more}
        </button>
      )}
    </>
  )
}

function FilterPanel({ facets, search }: { facets: NonNullable<SearchPage['facets']>; search: SearchState }) {
  const groups = FACETS.filter((facet) => facets[facet]?.length || search.filters[facet]?.length)
  return (
    <div className="filters">
      {groups.map((facet) => (
        <FacetGroup key={facet} facet={facet} values={facets[facet] ?? []} chosen={search.filters[facet] ?? []} onToggle={search.toggle} />
      ))}
      {search.activeFilters > 0 && (
        <button className="btn btn-secondary btn-small" onClick={search.clear}>{fr.catalog.clearFilters}</button>
      )}
    </div>
  )
}

function FacetGroup(props: { facet: Facet; values: FacetValue[]; chosen: string[]; onToggle: (facet: Facet, value: string) => void }) {
  const { facet, chosen, onToggle } = props
  const [all, setAll] = useState(false)
  const values = [...props.values]
  // A chosen value with no result left stays visible, so it can be removed.
  for (const value of chosen) {
    if (!values.some((v) => String(v.value) === value)) values.push({ value, count: 0 })
  }
  if (facet === 'level') values.sort((a, b) => Number(a.value) - Number(b.value))
  const shown = all ? values : values.filter((v, i) => i < FACET_SHOWN || chosen.includes(String(v.value)))
  return (
    <fieldset className="facet">
      <legend>{fr.catalog.facets[facet]}</legend>
      <div className="chips">
        {shown.map((v) => (
          <button key={String(v.value)} type="button" className="chip" aria-pressed={chosen.includes(String(v.value))}
            onClick={() => onToggle(facet, String(v.value))}>
            {facetLabel(facet, v)}
            <span className="chip-count">{formatNumber(String(v.count))}</span>
          </button>
        ))}
      </div>
      {values.length > FACET_SHOWN && (
        <button type="button" className="btn btn-secondary btn-small facet-more" onClick={() => setAll(!all)}>
          {all ? fr.catalog.showLess : fr.catalog.showAll(values.length)}
        </button>
      )}
    </fieldset>
  )
}

function facetLabel(facet: Facet, v: FacetValue): string {
  const value = String(v.value)
  if (v.name) return localized(v.name) ?? value
  if (facet === 'affects') return affectsNames[value] ?? value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function CatalogScreen() {
  const search = useSearchState()
  const { text, setText } = search
  return (
    <>
      <header className="page-head-row">
        <h1 className="type-display-l">{fr.catalog.title}</h1>
        <Link className="btn btn-secondary btn-small" to="/catalog/new">{fr.content.newEntry}</Link>
      </header>
      <search>
        <SearchField text={text} onChange={setText} label={fr.catalog.search} placeholder={fr.catalog.searchAll} />
      </search>
      {text.trim() ? <SearchResults search={search} /> : <TypeList />}
    </>
  )
}

function TypeList() {
  return (
    <>
      <nav className="list" aria-label={fr.catalog.title}>
        {entityTypes.map((t) => (
          <Link key={t.type} className="list-row" to={`/catalog/${t.type}`}>
            <span className="list-row-text">
              <span className="list-row-title">{t.name}</span>
              <span className="list-row-sub">{t.hint}</span>
            </span>
            <Icon name="chevron" />
          </Link>
        ))}
      </nav>
    </>
  )
}

/** One type, a page of 50 at a time, or the search within that type, with its filters. */
export function CatalogListScreen() {
  const type = useParams().type!
  const search = useSearchState()
  const [filtersOpen, setFiltersOpen] = useState(search.activeFilters > 0)
  const searching = search.text.trim() !== '' || search.activeFilters > 0 || filtersOpen
  return (
    <>
      <header className="page-head-title">
        <Link className="icon-link" to="/catalog" aria-label={`${fr.nav.back} : ${fr.catalog.title}`}>
          <Icon name="back" />
        </Link>
        <h1 className="type-display-l">{typeName(type)}</h1>
        <Link className="btn btn-secondary btn-small" style={{ marginLeft: 'auto' }} to={`/catalog/new?type=${encodeURIComponent(type)}`}>{fr.content.newEntry}</Link>
      </header>
      <search className="search-row">
        <SearchField text={search.text} onChange={search.setText} label={fr.catalog.searchIn(typeName(type))} />
        <button type="button" className="btn btn-secondary btn-small" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          {fr.catalog.filtersCount(search.activeFilters)}
        </button>
      </search>
      {searching ? <SearchResults key={type} search={search} type={type} showFilters={filtersOpen} /> : <TypePage key={type} type={type} />}
    </>
  )
}

function TypePage({ type }: { type: string }) {
  const [items, setItems] = useState<EntitySummary[]>([])
  const [next, setNext] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = (after?: string) => {
    setLoading(true)
    setError(null)
    api.entities(type, after).then(
      (page) => {
        setItems((current) => (after ? [...current, ...page.items] : page.items))
        setNext(page.next)
        setLoading(false)
      },
      (e) => {
        setError(messageOf(e))
        setLoading(false)
      },
    )
  }
  // Starts over when the type changes; `load` itself is a new function on every render.
  useEffect(() => load(), [type])

  return (
    <>
      {error && <ErrorNotice message={error} onRetry={() => load(items.at(-1)?.id)} />}
      {items.length > 0 && (
        <div className="list">
          {items.map((e) => (
            <Link key={e.id} className="list-row" to={`/catalog/entity/${e.id}`}>
              <span className="list-row-title">{localized(e.name) ?? e.id}</span>
              <Icon name="chevron" />
            </Link>
          ))}
        </div>
      )}
      {!loading && !error && items.length === 0 && <p className="muted">{fr.catalog.empty}</p>}
      {loading && <Loading />}
      {next && !loading && (
        <button className="btn btn-secondary" onClick={() => load(next)}>
          {fr.catalog.more}
        </button>
      )}
    </>
  )
}

export function EntityScreen() {
  const id = useParams().id!
  const { data, error, reload } = useLoad(
    () =>
      Promise.all([api.entity(id), api.entityVersions(id), api.me()]).then(async ([detail, versions, me]) => {
        const original = detail.variantOf ? await api.entity(detail.variantOf).catch(() => null) : null
        return [detail, versions, me, original] as const
      }),
    id,
  )
  if (error) return <ErrorNotice message={error} onRetry={reload} />
  if (!data) return <Loading />
  const [{ content: entity, variantOf, relations = [] }, versions, me, original] = data
  const spellLevels = relations
    .filter((r) => r.relation === 'on_spell_list')
    .map((r) => ({ id: r.to, name: localized(r.name ?? undefined) ?? r.to, level: r.extra.level }))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, 'fr'))
  const spell = entity.type === 'spell' ? ((entity.spell ?? {}) as Record<string, unknown>) : null
  const relationName = (to: string) => localized(relations.find((r) => r.to === to)?.name ?? undefined) ?? to
  const description = localized(entity.description)
  // The server has the last word; this only hides a button that would be refused.
  const editable = me.role === 'admin' || entity.provenance === 'team'

  return (
    <>
      <header className="page-head-title">
        <Link className="icon-link" to={`/catalog/${entity.type}`} aria-label={`${fr.nav.back} : ${typeName(entity.type)}`}>
          <Icon name="back" />
        </Link>
        <span className="muted">{fr.catalog.title} · {typeName(entity.type)}</span>
      </header>
      <StatBlock title={entityName(entity, entity.id)} subtitle={entity.source} aside={<Badge provenance={entity.provenance} />}>
        <div className="button-row">
          {editable && <Link className="btn btn-secondary btn-small" to={`/catalog/entity/${entity.id}/edit`}>{fr.content.edit}</Link>}
          <Link className="btn btn-secondary btn-small" to={`/catalog/new?from=${encodeURIComponent(entity.id)}`}>{fr.content.makeVariant}</Link>
        </div>
        {variantOf && (
          <p className="muted">
            {fr.content.variantOf} <Link to={`/catalog/entity/${variantOf}`}>{entityName(original?.content, variantOf)}</Link>
          </p>
        )}
        {entity.labels && entity.labels.length > 0 && (
          <div className="tags">{entity.labels.map((l) => <span key={l} className="tag">{l}</span>)}</div>
        )}
        <dl className="facts">
          {entity.prerequisite && (
            <>
              <dt>{fr.catalog.prerequisite}</dt>
              <dd className="formula">{entity.prerequisite}</dd>
            </>
          )}
          {spell && (
            <>
              <dt>{fr.catalog.spellLevels}</dt>
              <dd>
                {spellLevels.length === 0 && fr.catalog.noSpellLevel}
                {spellLevels.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ' · '}
                    <Link to={`/catalog/entity/${l.id}`}>{l.name}</Link> {l.level}
                  </span>
                ))}
              </dd>
            </>
          )}
          {spell &&
            Object.entries(fr.catalog.spellFields).map(([field, label]) => {
              const value = spell[field]
              const text = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
              return text ? (
                <div key={field} style={{ display: 'contents' }}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </div>
              ) : null
            })}
          {entity.usesPerDay != null && (
            <>
              <dt>{fr.catalog.usesPerDay}</dt>
              <dd className="formula">{String(entity.usesPerDay)}</dd>
            </>
          )}
        </dl>
      </StatBlock>
      {description && (
        <section className="page-head">
          <h2 className="type-heading">{fr.catalog.description}</h2>
          <p className="type-body-l prose">{description}</p>
        </section>
      )}
      {CLASS_TYPES.includes(entity.type) && <ClassProgression classId={entity.id} className={entityName(entity, entity.id)} />}
      {SPELL_LIST_TYPES.includes(entity.type) && <ListSpells listId={entity.id} />}
      {entity.effects && entity.effects.length > 0 && (
        <section className="page-head">
          <h2 className="type-heading">{fr.catalog.effects}</h2>
          <ul className="formula">{entity.effects.map((e, i) => <li key={i}>{effectText(e)}</li>)}</ul>
        </section>
      )}
      <section className="page-head">
        <h2 className="type-heading">{fr.catalog.history}</h2>
        <ul>
          {versions.map((v, i) => {
            // Versions come newest first: show the levels where they differ from the version before.
            const levels = v.relations?.on_spell_list
            const previous = versions[i + 1]?.relations?.on_spell_list
            const changed = levels != null && JSON.stringify(levels) !== JSON.stringify(previous)
            return (
              <li key={v.version}>
                {fr.catalog.version(v.version)} · {new Date(v.createdAt).toLocaleString('fr-FR')} · {v.author}
                {v.note ? ` · ${v.note}` : ''}
                {changed && ` · ${fr.catalog.levelsAt(levels.map((l) => `${relationName(l.to)} ${l.level}`).join(', '))}`}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

const SPELL_LIST_TYPES = ['class', 'prestige_class', 'domain']

/** The spells of a class or domain list, by level; nothing when the list is empty. */
function ListSpells({ listId }: { listId: string }) {
  const { data, error, reload } = useLoad(() => api.spellList(listId), listId)
  if (error) return <ErrorNotice message={error} onRetry={reload} />
  if (!data || data.length === 0) return null
  const levels = [...new Set(data.map((s) => s.level))]
  return (
    <section className="page-head">
      <h2 className="type-heading">{fr.catalog.classSpells}</h2>
      <dl className="facts">
        {levels.map((level) => (
          <div key={String(level)} style={{ display: 'contents' }}>
            <dt>{fr.catalog.spellLevel(level)}</dt>
            <dd>
              {data
                .filter((s) => s.level === level)
                .map((s) => ({ id: s.id, name: localized(s.name ?? undefined) ?? s.id }))
                .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                .map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ' · '}
                    <Link to={`/catalog/entity/${s.id}`}>{s.name}</Link>
                  </span>
                ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** `attack.melee add -@toggle.power_attack.value (untyped) if active('toggle.power_attack')`: the content as written. */
function effectText(e: Effect): string {
  return [e.target, e.op, String(e.value), e.bonusType && `(${e.bonusType})`, e.condition && `if ${e.condition}`, e.situation && `[${e.situation}]`]
    .filter(Boolean)
    .join(' ')
}

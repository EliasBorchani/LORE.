import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client'
import type { Person, RulesetDetail, RulesetEntity } from '../api/types'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { lastGroup } from '../group/GroupContext'
import { fr, typeName } from '../i18n/fr'
import { localized } from '../sheet/names'
import { messageOf, useLoad } from '../useLoad'

/** Every entity of a ruleset, all pages (a ruleset stays small: a size cap per ruleset is planned). */
async function allEntities(slug: string): Promise<RulesetEntity[]> {
  const items: RulesetEntity[] = []
  let after: string | undefined
  do {
    const page = await api.rulesetEntities(slug, after)
    items.push(...page.items)
    after = page.next
  } while (after)
  return items
}

/** People the owner plays with: the members of their groups, the only ones they can name editors. */
async function playmates(): Promise<Person[]> {
  const groups = await api.groups()
  const members = (await Promise.all(groups.map((g) => api.members(g.id)))).flat()
  const me = await api.me()
  const byId = new Map(members.filter((m) => m.userId !== me.id).map((m) => [m.userId, { id: m.userId, login: m.login }]))
  return [...byId.values()].sort((a, b) => a.login.localeCompare(b.login))
}

/**
 * A ruleset's page: its entities, and for its owner the editors, visibility and archive. A public ruleset is added to
 * a group by this page's link or its slug.
 */
export function RulesetScreen() {
  const slug = useParams().slug!
  const { data, error, reload } = useLoad(() => Promise.all([api.ruleset(slug), allEntities(slug)]), slug)
  if (error) return <ErrorNotice message={error} onRetry={reload} />
  if (!data) return <Loading />
  const [ruleset, entities] = data
  // Entity pages are read through a group; the one used last is the likely place.
  const group = lastGroup()

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>{fr.rulesets.title}</p>
      <h1 className="type-display-l">{ruleset.name}</h1>
      <p className="muted">
        {ruleset.slug} · {fr.rulesets.visibility[ruleset.visibility]} · {fr.rulesets.count(ruleset.entities)}
        {ruleset.archived ? ` · ${fr.groups.archived}` : ''}
      </p>
      {ruleset.access === 'own' && <OwnerTools ruleset={ruleset} reload={reload} />}
      {ruleset.access !== 'own' && ruleset.editors && (
        <p className="muted">{fr.rulesets.editorsList([ruleset.owner, ...ruleset.editors].filter(Boolean).map((p) => p!.login).join(', '))}</p>
      )}
      <StatBlock title={fr.rulesets.entities}>
        {entities.length === 0 && <p className="muted">{fr.rulesets.empty}</p>}
        {entities.map((e) => {
          const label = (
            <span className="list-row-text">
              <span className="list-row-title">{localized(e.name) ?? e.id}</span>
              <span className="list-row-sub">
                {typeName(e.type)} · {e.id}{e.overrides ? ` · ${fr.rulesets.overrides(e.overrides)}` : ''}
              </span>
            </span>
          )
          return group ? (
            <Link key={e.id} className="list-row" to={`/g/${group}/catalog/entity/${encodeURIComponent(e.overrides ?? e.id)}`}>{label}</Link>
          ) : (
            <div key={e.id} className="list-row">{label}</div>
          )
        })}
      </StatBlock>
    </>
  )
}

function OwnerTools({ ruleset, reload }: { ruleset: RulesetDetail; reload: () => void }) {
  const { data: people } = useLoad(playmates, 'playmates')
  const [error, setError] = useState<string | null>(null)
  const editors = new Set((ruleset.editors ?? []).map((e) => e.id))
  const run = (change: Promise<unknown>) => change.then(() => { setError(null); reload() }, (e) => setError(messageOf(e)))

  return (
    <StatBlock title={fr.rulesets.settings}>
      <div className="button-row">
        <button className="btn btn-secondary btn-small"
          onClick={() => run(api.updateRuleset(ruleset.slug, { visibility: ruleset.visibility === 'public' ? 'private' : 'public' }))}>
          {ruleset.visibility === 'public' ? fr.rulesets.makePrivate : fr.rulesets.makePublic}
        </button>
        <button className="btn btn-secondary btn-small" onClick={() => run(api.updateRuleset(ruleset.slug, { archived: !ruleset.archived }))}>
          {ruleset.archived ? fr.rulesets.unarchive : fr.rulesets.archive}
        </button>
      </div>
      {ruleset.visibility === 'public' && <p className="field-hint">{fr.rulesets.publicHint(`${window.location.origin}/rulesets/${ruleset.slug}`)}</p>}
      <h3 className="type-heading">{fr.rulesets.editors}</h3>
      <p className="field-hint">{fr.rulesets.editorsHint}</p>
      {!people && <Loading />}
      <div className="chips">
        {people?.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={editors.has(p.id)}
            onClick={() => run(api.setEditors(ruleset.slug, editors.has(p.id) ? [...editors].filter((id) => id !== p.id) : [...editors, p.id]))}>
            {p.login}
          </button>
        ))}
      </div>
      {error && <p className="warning" role="alert">{error}</p>}
    </StatBlock>
  )
}

import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { lastGroup } from '../group/GroupContext'
import { fr } from '../i18n/fr'
import { messageOf, useLoad } from '../useLoad'

/**
 * The account's groups. One group, or the one used last, opens straight away (`?all` shows the list anyway, as the
 * switcher's « Tous les groupes » does).
 */
export function GroupsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: groups, error, reload } = useLoad(api.groups, 'groups')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  if (error) return <ErrorNotice message={error} onRetry={reload} />
  if (!groups) return <Loading />
  const active = groups.filter((g) => !g.archived)
  if (!params.has('all')) {
    const last = active.find((g) => g.id === lastGroup())
    const only = active.length === 1 ? active[0] : undefined
    const open = last ?? only
    if (open) return <Navigate to={`/g/${open.id}`} replace />
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setCreateError(null)
    try {
      const group = await api.createGroup(name.trim())
      navigate(`/g/${group.id}/settings`)
    } catch (e) {
      setCreateError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="type-display-l">{fr.groups.title}</h1>
      {groups.length === 0 && <p className="muted">{fr.groups.none}</p>}
      {groups.map((g) => (
        <Link key={g.id} to={`/g/${g.id}`} className="list-row">
          <span className="list-row-text">
            <span className="list-row-title">{g.name}</span>
            <span className="list-row-sub">{fr.groups.rpgs[g.rpg] ?? g.rpg}{g.archived ? ` · ${fr.groups.archived}` : ''}</span>
          </span>
        </Link>
      ))}
      <StatBlock title={fr.groups.create}>
        <form onSubmit={create}>
          <label className="field">
            <span>{fr.groups.name}</span>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="field-hint">{fr.groups.createHint}</p>
          {createError && <p className="warning" role="alert">{createError}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{fr.groups.createButton}</button>
        </form>
      </StatBlock>
    </>
  )
}

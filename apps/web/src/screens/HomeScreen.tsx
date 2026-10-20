import { Link } from 'react-router'
import { api } from '../api/client'
import type { CharacterSummary } from '../api/types'
import { ErrorNotice, Loading } from '../components/grimoire'
import { fr } from '../i18n/fr'
import { useLoad } from '../useLoad'
import { useGroup } from '../group/GroupContext'

/** The group's characters: the caller's, then the others' when « See characters » shows them. */
export function HomeScreen() {
  const { group, path: groupPath } = useGroup()
  const { data, error, reload } = useLoad(
    () => Promise.all([api.characters(group.id), api.me()]),
    `characters/${group.id}`,
  )
  const [characters, me] = data ?? [null, null]
  const mine = characters?.filter((c) => c.ownerId === me?.id) ?? []
  const others = characters?.filter((c) => c.ownerId !== me?.id) ?? []

  const row = (c: CharacterSummary) => (
    <Link key={c.id} to={groupPath(`/characters/${c.id}`)} className="block" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
      <div className="block-head">
        <span className="block-title" style={{ fontSize: 28 }}>{c.name}</span>
        <span>
          {fr.home.level} <strong className="type-stat-m">{c.level}</strong>
        </span>
      </div>
    </Link>
  )

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        {group.name} · <Link to="/?all">{fr.groups.switch}</Link>
      </p>
      <div className="page-head-row">
        <h1 className="type-display-l">{fr.home.title}</h1>
        {!group.archived && (
          <Link className="btn btn-primary btn-small" to={groupPath('/characters/new')}>{fr.editor.newCharacter}</Link>
        )}
      </div>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!characters && !error && <Loading />}
      {characters && mine.length === 0 && <p className="muted">{fr.home.empty}</p>}
      {mine.map(row)}
      {others.length > 0 && (
        <>
          <h2 className="type-heading">{fr.home.others}</h2>
          {others.map(row)}
        </>
      )}
    </>
  )
}

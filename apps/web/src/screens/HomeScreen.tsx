import { Link } from 'react-router'
import { api } from '../api/client'
import { ErrorNotice, Loading } from '../components/grimoire'
import { fr } from '../i18n/fr'
import { useLoad } from '../useLoad'

export function HomeScreen() {
  const { data: characters, error, reload } = useLoad(api.characters, 'characters')

  return (
    <>
      <div className="page-head-row">
        <h1 className="type-display-l">{fr.home.title}</h1>
        <Link className="btn btn-primary btn-small" to="/characters/new">{fr.editor.newCharacter}</Link>
      </div>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!characters && !error && <Loading />}
      {characters?.length === 0 && <p className="muted">{fr.home.empty}</p>}
      {characters?.map((c) => (
        <Link key={c.id} to={`/characters/${c.id}`} className="block" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <div className="block-head">
            <span className="block-title" style={{ fontSize: 28 }}>{c.name}</span>
            <span>
              {fr.home.level} <strong className="type-stat-m">{c.level}</strong>
            </span>
          </div>
        </Link>
      ))}
    </>
  )
}

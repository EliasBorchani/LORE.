import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { api } from '../api/client'
import { fr } from '../i18n/fr'
import { EntityPanel } from './EntityPanel'
import { Icon } from './grimoire'

const sections = [
  { to: '/', label: fr.nav.characters, icon: 'person' as const, matches: (path: string) => path === '/' || path.startsWith('/characters') },
  { to: '/catalog', label: fr.nav.catalog, icon: 'book' as const, matches: (path: string) => path.startsWith('/catalog') },
  { to: '/account', label: fr.nav.account, icon: 'gear' as const, matches: (path: string) => path.startsWith('/account') },
]

/** Pages behind login: a top bar on wide screens, a bottom bar on phones. */
export function Shell() {
  const location = useLocation()
  if (!api.hasSession) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const links = sections.map((s) => (
    <Link key={s.to} to={s.to} aria-current={s.matches(location.pathname) ? 'page' : undefined}>
      <Icon name={s.icon} />
      {s.label}
    </Link>
  ))
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{fr.app}</span>
        <nav aria-label={fr.nav.main}>{links}</nav>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={fr.nav.main}>
        {links}
      </nav>
      <EntityPanel />
    </div>
  )
}

import { Link, Navigate, Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { api } from '../api/client'
import { fr } from '../i18n/fr'
import { useLoad } from '../useLoad'
import { Icon } from './grimoire'

type Section = { to: string; label: string; icon: 'person' | 'book' | 'people' | 'gear'; current: boolean }

/** Pages behind login: a top bar on wide screens, a bottom bar on phones. Inside a group, its sections. */
export function Shell() {
  const location = useLocation()
  const inGroup = useMatch('/g/:groupId/*')
  const groupId = inGroup?.params.groupId
  if (!api.hasSession) return <Navigate to="/login" replace state={{ from: location.pathname + location.hash }} />

  const base = groupId ? `/g/${groupId}` : ''
  const path = location.pathname
  const sections: Section[] = groupId
    ? [
        { to: base, label: fr.nav.characters, icon: 'person', current: path === base || path.startsWith(`${base}/characters`) },
        { to: `${base}/catalog`, label: fr.nav.catalog, icon: 'book', current: path.startsWith(`${base}/catalog`) },
        { to: `${base}/settings`, label: fr.nav.group, icon: 'people', current: path.startsWith(`${base}/settings`) },
      ]
    : [{ to: '/', label: fr.nav.groups, icon: 'people', current: path === '/' || path.startsWith('/rulesets') }]
  sections.push({ to: '/account', label: fr.nav.account, icon: 'gear', current: path.startsWith('/account') })

  const links = sections.map((s) => (
    <Link key={s.to} to={s.to} aria-current={s.current ? 'page' : undefined}>
      <Icon name={s.icon} />
      {s.label}
    </Link>
  ))
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{fr.app}</span>
        {groupId && <GroupSwitcher current={groupId} />}
        <nav aria-label={fr.nav.main}>{links}</nav>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={fr.nav.main}>
        {links}
      </nav>
    </div>
  )
}

/** Wide screens: every group of the account; on phones, the group's home links to the list instead. */
function GroupSwitcher({ current }: { current: string }) {
  const navigate = useNavigate()
  const { data: groups } = useLoad(api.groups, 'groups')
  if (!groups || groups.length < 2) return null
  return (
    <label className="group-switcher">
      <span className="visually-hidden">{fr.groups.switch}</span>
      <select className="input" value={current} onChange={(e) => navigate(e.target.value ? `/g/${e.target.value}` : '/?all')}>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        <option value="">{fr.groups.all}</option>
      </select>
    </label>
  )
}

import { Link, NavLink, Outlet, useParams } from 'react-router'
import { api } from '../../api/client'
import { ErrorNotice, Icon, Loading } from '../../components/grimoire'
import { fr } from '../../i18n/fr'
import { classSummary } from '../../sheet/names'
import { SheetProvider, useSheet } from '../../sheet/SheetContext'
import { useLoad } from '../../useLoad'
import { useGroupPath } from '../../group/GroupContext'

/** Loads the character and the part of the catalog it needs, then gives both to every page under it. */
export function CharacterLayout() {
  const id = useParams().id!
  const { data, error, reload } = useLoad(() => Promise.all([api.character(id), api.characterCatalog(id)]), id)

  if (error) return <ErrorNotice message={`${fr.sheet.loadFailed} ${error}`} onRetry={reload} />
  if (!data) return <Loading />
  const [record, closure] = data
  return (
    <SheetProvider key={id} record={record} closure={closure} reload={reload}>
      <Outlet />
    </SheetProvider>
  )
}

export function CharacterHeader({ back, backLabel = fr.nav.characters }: { back?: string; backLabel?: string }) {
  const groupPath = useGroupPath()
  back ??= groupPath('')
  const { record, name, stat } = useSheet()
  const level = stat('level') ?? String(record.character.levels?.length ?? 0)
  return (
    <header className="page-head">
      <div className="page-head-row">
        <div className="page-head-title">
          <Link className="icon-link" to={back} aria-label={`${fr.nav.back} : ${backLabel}`}>
            <Icon name="back" />
          </Link>
          <h1 className="type-display-l">{record.character.name}</h1>
        </div>
        <Link className="btn btn-secondary btn-small" to={groupPath(`/characters/${record.id}/build`)}>
          {fr.sheet.build}
        </Link>
      </div>
      <span className="muted">
        {fr.home.level} <strong className="gilt">{level}</strong> · {classSummary(record.character, name)}
      </span>
    </header>
  )
}

/** The sheet with its tabs. */
export function SheetPage() {
  const groupPath = useGroupPath()
  const { record } = useSheet()
  const base = groupPath(`/characters/${record.id}`)
  const tabs = [
    { to: base, label: fr.sheet.tabs.combat, end: true },
    { to: `${base}/magic`, label: fr.sheet.tabs.magic },
    { to: `${base}/abilities`, label: fr.sheet.tabs.abilities },
    { to: `${base}/skills`, label: fr.sheet.tabs.skills },
    { to: `${base}/feats`, label: fr.sheet.tabs.feats },
  ]
  return (
    <>
      <CharacterHeader />
      <nav className="tabs" aria-label={fr.sheet.sections}>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}

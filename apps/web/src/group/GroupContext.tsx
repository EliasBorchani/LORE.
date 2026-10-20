import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { Link, Outlet, useParams } from 'react-router'
import { api, type GroupApi } from '../api/client'
import type { GroupDetail, Permission } from '../api/types'
import { EntityPanel } from '../components/EntityPanel'
import { ErrorNotice, Loading } from '../components/grimoire'
import { fr } from '../i18n/fr'
import { useLoad } from '../useLoad'

const LAST_GROUP = 'lore.lastGroup'

export interface GroupState {
  group: GroupDetail
  /** The catalog as this group sees it. */
  catalog: GroupApi
  /** `/catalog/x` → `/g/<group>/catalog/x`. */
  path: (to: string) => string
  /** « Admin » holds every permission. */
  can: (permission: Permission) => boolean
  reload: () => void
}

const GroupContext = createContext<GroupState | null>(null)

export function useGroup(): GroupState {
  const state = useContext(GroupContext)
  if (!state) throw new Error('useGroup outside a group page')
  return state
}

export const useGroupApi = () => useGroup().catalog
export const useGroupPath = () => useGroup().path

/** The group a viewer used last, so « / » can open it again. Storage may be missing: then there is none. */
export function lastGroup(): string | null {
  try {
    return localStorage.getItem(LAST_GROUP)
  } catch {
    return null
  }
}

function rememberGroup(id: string) {
  try {
    localStorage.setItem(LAST_GROUP, id)
  } catch {
    // Only a convenience.
  }
}

/** Every page of a group (`/g/<group>/…`): loads the group, then its pages read the catalog through it. */
export function GroupLayout() {
  const { groupId = '' } = useParams()
  const { data: group, error, reload } = useLoad(() => api.group(groupId).then((g) => (rememberGroup(g.id), g)), groupId)
  if (error) {
    return (
      <>
        <ErrorNotice message={error} onRetry={reload} />
        <Link className="btn btn-secondary" to="/">{fr.groups.all}</Link>
      </>
    )
  }
  if (!group) return <Loading />
  return (
    <GroupProvider group={group} reload={reload}>
      <Outlet />
      <EntityPanel />
    </GroupProvider>
  )
}

export function GroupProvider({ group, reload, children }: { group: GroupDetail; reload: () => void; children: ReactNode }) {
  const path = useCallback((to: string) => `/g/${group.id}${to}`, [group.id])
  const value = useMemo<GroupState>(() => ({
    group,
    catalog: api.inGroup(group.id),
    path,
    can: (permission) => group.permissions.includes('admin') || group.permissions.includes(permission),
    reload,
  }), [group, path, reload])
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

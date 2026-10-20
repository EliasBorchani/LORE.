import type { GroupApi } from '../api/client'
import type { EntitySummary } from '../api/types'

/** By group, then type: two groups see different rulesets. */
const cache = new Map<string, Promise<EntitySummary[]>>()

/** Every entity of a type (id, name, labels) as the group sees it, all pages, fetched once per page load: lists for the pickers. */
export function allOfType(groupApi: GroupApi, type: string): Promise<EntitySummary[]> {
  const key = `${groupApi.groupId}/${type}`
  let list = cache.get(key)
  if (!list) {
    list = (async () => {
      const items: EntitySummary[] = []
      let after: string | undefined
      do {
        const page = await groupApi.entities(type, after, 200)
        items.push(...page.items)
        after = page.next
      } while (after)
      return items
    })()
    list.catch(() => cache.delete(key))
    cache.set(key, list)
  }
  return list
}

/** After the catalog changed in this page (an entity created or renamed). */
export function forgetLists() {
  cache.clear()
}

import { api } from '../api/client'
import type { EntitySummary } from '../api/types'

const cache = new Map<string, Promise<EntitySummary[]>>()

/** Every entity of a type (id, name, labels), all pages, fetched once per page load: lists for the pickers. */
export function allOfType(type: string): Promise<EntitySummary[]> {
  let list = cache.get(type)
  if (!list) {
    list = (async () => {
      const items: EntitySummary[] = []
      let after: string | undefined
      do {
        const page = await api.entities(type, after, 200)
        items.push(...page.items)
        after = page.next
      } while (after)
      return items
    })()
    list.catch(() => cache.delete(type))
    cache.set(type, list)
  }
  return list
}

/** After the catalog changed in this page (an entity created or renamed). */
export function forgetLists() {
  cache.clear()
}

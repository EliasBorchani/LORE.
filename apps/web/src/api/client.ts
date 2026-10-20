import type {
  CharacterRecord,
  CharacterSummary,
  Character,
  Closure,
  CoreSections,
  Entity,
  EntityDetail,
  EntityPage,
  EntityVersion,
  GroupDetail,
  GroupSummary,
  Invitation,
  InviteReply,
  Me,
  Member,
  Permission,
  RulesetDetail,
  RulesetEntity,
  RulesetSummary,
  SearchFilters,
  SearchPage,
  SpellLevel,
  SpellListEntry,
  TokenPair,
} from './types'

const REFRESH_KEY = 'lore.refreshToken'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === 'object' && body && 'error' in body ? String(body.error) : `HTTP ${status}`)
  }
}

/** Browser storage can be missing or throw (private windows, blocked site data): the app then keeps no session. */
export interface KeyStore {
  get(key: string): string | null
  set(key: string, value: string | null): void
}

export const browserStore: KeyStore = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // Nothing to do: the session simply does not survive a reload.
    }
  },
}

/**
 * The server API. The access token lives in memory only; the refresh token in storage, so a reload keeps the
 * session (PoC trade-off: a script injected into the page could read it; an httpOnly cookie is the fix later).
 */
export class ApiClient {
  private accessToken: string | null = null
  /** One refresh at a time: requests failing together wait for the same one. */
  private refreshing: Promise<boolean> | null = null
  onSignedOut: () => void = () => {}

  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly store: KeyStore = browserStore,
    private readonly base = '/api',
  ) {}

  get hasSession(): boolean {
    return this.accessToken != null || this.store.get(REFRESH_KEY) != null
  }

  async login(login: string, password: string): Promise<void> {
    const response = await this.fetchImpl(`${this.base}/auth/login`, jsonInit('POST', { login, password }))
    this.keep(await read<TokenPair>(response))
  }

  /** The email and role an invitation link is for; 404 when the link is unknown, used or expired. */
  async invitation(token: string): Promise<Invitation> {
    return read<Invitation>(await this.fetchImpl(`${this.base}/auth/invitation`, jsonInit('POST', { token })))
  }

  /** Creates the invited account (its login is the email) and opens its session. */
  async acceptInvitation(token: string, password: string): Promise<void> {
    const response = await this.fetchImpl(`${this.base}/auth/invitation/accept`, jsonInit('POST', { token, password }))
    this.keep(await read<TokenPair>(response))
  }

  async logout(): Promise<void> {
    const refreshToken = this.store.get(REFRESH_KEY)
    this.forget()
    if (refreshToken) {
      await this.fetchImpl(`${this.base}/auth/logout`, jsonInit('POST', { refreshToken })).catch(() => undefined)
    }
  }

  me = () => this.request<Me>('GET', '/auth/me')
  /** The caller's characters in a group, and the others' when « See characters » allows it. */
  characters = (groupId: string) => this.request<CharacterSummary[]>('GET', `/characters?group=${encodeURIComponent(groupId)}`)
  character = (id: string) => this.request<CharacterRecord>('GET', `/characters/${id}`)
  /** The closure through the character's own group. */
  characterCatalog = (id: string) => this.request<Closure>('GET', `/characters/${id}/catalog`)
  createCharacter = (groupId: string, character: Character) =>
    this.request<CharacterRecord>('POST', '/characters', { groupId, character })
  saveCharacter = (id: string, updatedAt: string, character: Character) =>
    this.request<CharacterRecord>('PUT', `/characters/${id}`, { updatedAt, character })
  moveCharacter = (id: string, groupId: string) => this.request<CharacterRecord>('POST', `/characters/${id}/move`, { groupId })
  /**
   * Into a ruleset (`ruleset`, its slug; `overrides` makes it a house rule), or official content (platform admin).
   * `spellLists`: a spell's levels (only for spells).
   */
  createEntity = (entity: Entity, note: string, target: { ruleset?: string; overrides?: string }, spellLists?: SpellLevel[]) =>
    this.request<EntityDetail>('POST', '/entities', { entity, note, ...target, ...(spellLists ? { spellLists } : {}) })
  /** 409 when someone saved since `version` (the error body has `current`), 403 when the caller may not change it. */
  updateEntity = (entity: Entity, version: number, note: string, spellLists?: SpellLevel[]) =>
    this.request<EntityDetail>('PUT', `/entities/${encodeURIComponent(entity.id)}`, { entity, version, note, ...(spellLists ? { spellLists } : {}) })

  groups = () => this.request<GroupSummary[]>('GET', '/groups')
  createGroup = (name: string, rpg = 'dnd35') => this.request<GroupDetail>('POST', '/groups', { name, rpg })
  group = (id: string) => this.request<GroupDetail>('GET', `/groups/${id}`)
  updateGroup = (id: string, change: { name?: string; archived?: boolean }) => this.request<GroupDetail>('PATCH', `/groups/${id}`, change)
  members = (id: string) => this.request<Member[]>('GET', `/groups/${id}/members`)
  setPermissions = (id: string, userId: number, permissions: Permission[]) =>
    this.request<Permission[]>('PUT', `/groups/${id}/members/${userId}`, { permissions })
  removeMember = (id: string, userId: number) => this.request<null>('DELETE', `/groups/${id}/members/${userId}`)
  leaveGroup = (id: string) => this.request<null>('POST', `/groups/${id}/leave`)
  /** Slugs, in order: the last one wins when two override the same entity. */
  setGroupRulesets = (id: string, rulesets: string[]) => this.request<GroupDetail>('PUT', `/groups/${id}/rulesets`, { rulesets })
  invite = (id: string, email: string, permissions?: Permission[]) =>
    this.request<InviteReply>('POST', `/groups/${id}/invitations`, { email, ...(permissions ? { permissions } : {}) })
  /** An existing account opens a group invitation sent to its email. */
  joinGroup = (token: string) => this.request<GroupSummary>('POST', '/groups/join', { token })

  rulesets = () => this.request<RulesetSummary[]>('GET', '/rulesets')
  createRuleset = (slug: string, name: string, visibility: 'private' | 'public', rpg = 'dnd35') =>
    this.request<RulesetDetail>('POST', '/rulesets', { slug, name, rpg, visibility })
  ruleset = (slug: string) => this.request<RulesetDetail>('GET', `/rulesets/${slug}`)
  updateRuleset = (slug: string, change: { name?: string; visibility?: 'private' | 'public'; archived?: boolean }) =>
    this.request<RulesetDetail>('PATCH', `/rulesets/${slug}`, change)
  setEditors = (slug: string, editors: number[]) => this.request<RulesetDetail>('PUT', `/rulesets/${slug}/editors`, { editors })
  rulesetEntities = (slug: string, after?: string) =>
    this.request<{ items: RulesetEntity[]; next?: string }>('GET', `/rulesets/${slug}/entities?limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`)

  /** Catalog reads, through a group: its RPG's official content, then its rulesets, with house rules applied. */
  inGroup = (groupId: string) => new GroupApi(this, groupId)

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.accessToken == null && !(await this.refresh())) throw this.signedOut()
    let response = await this.send(method, path, body)
    if (response.status === 401) {
      if (!(await this.refresh())) throw this.signedOut()
      response = await this.send(method, path, body)
      if (response.status === 401) throw this.signedOut()
    }
    return read<T>(response)
  }

  private send(method: string, path: string, body: unknown): Promise<Response> {
    const init = jsonInit(method, body)
    init.headers = { ...init.headers, authorization: `Bearer ${this.accessToken}` }
    return this.fetchImpl(this.base + path, init)
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.store.get(REFRESH_KEY)
    if (!refreshToken) return false
    const response = await this.fetchImpl(`${this.base}/auth/refresh`, jsonInit('POST', { refreshToken }))
    if (!response.ok) {
      this.forget()
      return false
    }
    this.keep(await response.json())
    return true
  }

  private keep(tokens: TokenPair) {
    this.accessToken = tokens.accessToken
    this.store.set(REFRESH_KEY, tokens.refreshToken)
  }

  private forget() {
    this.accessToken = null
    this.store.set(REFRESH_KEY, null)
  }

  private signedOut(): ApiError {
    this.forget()
    this.onSignedOut()
    return new ApiError(401, { error: 'login required' })
  }
}

function jsonInit(method: string, body: unknown): { method: string; headers: Record<string, string>; body?: string } {
  return body === undefined
    ? { method, headers: {} }
    : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

async function read<T>(response: Response): Promise<T> {
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}

/** The catalog as one group sees it. */
export class GroupApi {
  private readonly base: string

  constructor(
    private readonly client: ApiClient,
    readonly groupId: string,
  ) {
    this.base = `/groups/${encodeURIComponent(groupId)}`
  }

  closure = (roots: string[]) => this.client.request<Closure>('POST', `${this.base}/catalog/closure`, { roots })
  /** The catalog a draft character needs (not saved yet), as `characterCatalog` gives for a saved one. */
  draftCatalog = (character: Character) => this.client.request<Closure>('POST', `${this.base}/catalog/closure`, { character })
  spellList = (classId: string) =>
    this.client.request<SpellListEntry[]>('GET', `${this.base}/catalog/spell-list/${encodeURIComponent(classId)}`)
  entities = (type: string, after?: string, limit = 50) =>
    this.client.request<EntityPage>('GET', `${this.base}/entities?type=${encodeURIComponent(type)}&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`)
  /** Words in names, ids and descriptions, plus filters; `facets` adds the count of each filter value. */
  search = (params: SearchParams) => this.client.request<SearchPage>('GET', this.base + searchPath(params))
  core = () => this.client.request<CoreSections>('GET', `${this.base}/catalog/core`)
  entity = (id: string) => this.client.request<EntityDetail>('GET', `${this.base}/entities/${encodeURIComponent(id)}`)
  entityVersions = (id: string) => this.client.request<EntityVersion[]>('GET', `${this.base}/entities/${encodeURIComponent(id)}/versions`)
}

export interface SearchParams {
  q?: string
  type?: string
  filters?: SearchFilters
  offset?: number
  limit?: number
  facets?: boolean
}

/** A filter's values go comma-separated (any of them); empty filters are left out. */
export function searchPath({ q, type, filters = {}, offset = 0, limit = 50, facets = false }: SearchParams): string {
  const query = new URLSearchParams()
  if (q?.trim()) query.set('q', q.trim())
  if (type) query.set('type', type)
  for (const [facet, values] of Object.entries(filters)) {
    if (values?.length) query.set(facet, values.join(','))
  }
  query.set('offset', String(offset))
  query.set('limit', String(limit))
  if (facets) query.set('facets', 'true')
  return `/search?${query}`
}

export const api = new ApiClient()

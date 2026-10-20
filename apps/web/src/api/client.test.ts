import { describe, expect, it } from 'vitest'
import { ApiClient, ApiError, searchPath, type KeyStore } from './client'

function memoryStore(initial: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    get: (key) => data[key] ?? null,
    set: (key, value) => {
      if (value == null) delete data[key]
      else data[key] = value
    },
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const tokens = (n: number) => ({ accessToken: `access${n}`, refreshToken: `refresh${n}`, tokenType: 'Bearer', expiresIn: 900 })

/** A fake server: `/auth/refresh` swaps refresh1 for a new pair; other calls need the current access token. */
function fakeServer() {
  let valid = 'none'
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    calls.push(path)
    if (path === '/api/auth/refresh') {
      const { refreshToken } = JSON.parse(String(init?.body))
      if (refreshToken !== 'refresh1') return json(401, { error: 'invalid' })
      valid = 'access2'
      return json(200, tokens(2))
    }
    const auth = (init?.headers as Record<string, string>).authorization
    return auth === `Bearer ${valid}` ? json(200, { ok: true }) : json(401, { error: 'expired' })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('ApiClient', () => {
  it('refreshes once, keeps the new refresh token and retries', async () => {
    const server = fakeServer()
    const store = memoryStore({ 'lore.refreshToken': 'refresh1' })
    const client = new ApiClient(server.fetchImpl, store)

    await expect(client.request('GET', '/characters')).resolves.toEqual({ ok: true })
    expect(store.data['lore.refreshToken']).toBe('refresh2')
    expect(server.calls).toEqual(['/api/auth/refresh', '/api/characters'])
  })

  it('shares one refresh between requests failing together', async () => {
    const server = fakeServer()
    const client = new ApiClient(server.fetchImpl, memoryStore({ 'lore.refreshToken': 'refresh1' }))

    await Promise.all([client.request('GET', '/a'), client.request('GET', '/b')])
    expect(server.calls.filter((c) => c === '/api/auth/refresh')).toHaveLength(1)
  })

  it('signs out when the refresh fails', async () => {
    const server = fakeServer()
    const store = memoryStore({ 'lore.refreshToken': 'stolen-and-revoked' })
    const client = new ApiClient(server.fetchImpl, store)
    let signedOut = false
    client.onSignedOut = () => (signedOut = true)

    await expect(client.request('GET', '/characters')).rejects.toBeInstanceOf(ApiError)
    expect(signedOut).toBe(true)
    expect(store.data).toEqual({})
    expect(client.hasSession).toBe(false)
  })

  it('reports server errors with their body', async () => {
    const fetchImpl = (async () => json(409, { error: 'changed', current: { version: 3 } })) as unknown as typeof fetch
    const client = new ApiClient(fetchImpl, memoryStore())
    ;(client as unknown as { accessToken: string }).accessToken = 'x'

    const error = (await client.request('PUT', '/characters/1', {}).catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.body).toEqual({ error: 'changed', current: { version: 3 } })
  })

  it('accepting an invitation opens the session', async () => {
    const store = memoryStore()
    const sent: string[] = []
    const client = new ApiClient((async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${input} ${init?.body}`)
      return json(200, tokens(1))
    }) as typeof fetch, store)

    await client.acceptInvitation('abc', 'a long enough passphrase')
    expect(sent).toEqual(['/api/auth/invitation/accept {"token":"abc","password":"a long enough passphrase"}'])
    expect(store.data['lore.refreshToken']).toBe('refresh1')
    expect(client.hasSession).toBe(true)
  })
})

describe('searchPath', () => {
  it('sends each filter comma-separated and leaves empty ones out', () => {
    expect(searchPath({ q: ' boule de feu ', type: 'spell', filters: { descriptor: ['feu', 'froid'], school: [] }, facets: true }))
      .toBe('/search?q=boule+de+feu&type=spell&descriptor=feu%2Cfroid&offset=0&limit=50&facets=true')
    expect(searchPath({ filters: { level: ['8'] }, offset: 50 })).toBe('/search?level=8&offset=50&limit=50')
  })
})

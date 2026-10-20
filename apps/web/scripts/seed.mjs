// Dev only: adds a character to an account's first group (making a « Test » group when it has none), so a fresh
// database has a sheet to open.
// Usage: LORE_LOGIN=elias LORE_PASSWORD=... npm run seed [-- path/to/character.json]
import { readFileSync } from 'node:fs'

const server = process.env.LORE_SERVER ?? 'http://localhost:8080'
const file = process.argv[2] ?? new URL('../../../test-references/danalieth/character.json', import.meta.url)
const { LORE_LOGIN: login, LORE_PASSWORD: password } = process.env
if (!login || !password) {
  console.error('Set LORE_LOGIN and LORE_PASSWORD.')
  process.exit(1)
}

async function call(path, body, token, method = 'POST') {
  const response = await fetch(server + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${json.error}`)
  return json
}

const { accessToken } = await call('/auth/login', { login, password })
const character = JSON.parse(readFileSync(file, 'utf8'))
const groups = await call('/groups', undefined, accessToken, 'GET')
const group = groups[0] ?? (await call('/groups', { name: 'Test', rpg: 'dnd35' }, accessToken))
const record = await call('/characters', { groupId: group.id, character }, accessToken)
console.log(`${record.character.name} created: /g/${group.id}/characters/${record.id}`)

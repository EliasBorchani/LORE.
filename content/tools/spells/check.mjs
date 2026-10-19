// Checks spell batch files: house format, then strict engine decoding and formula checks with the whole catalog.
// Usage (from anywhere): node check.mjs <batch.json>...
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const files = process.argv.slice(2)
const problems = []
const SPELL_KEYS = new Set(['school', 'subschool', 'descriptors', 'components', 'castingTime', 'range', 'target', 'area', 'effect', 'duration', 'savingThrow', 'spellResistance'])
const ENTITY_KEYS = new Set(['id', 'type', 'name', 'provenance', 'labels', 'description', 'spell', 'effects', 'note', 'usesPerDay', 'source', 'status'])

const catalog = read(R + 'test-references/danalieth/catalog.json')
const add = (batch) => {
  catalog.entities = catalog.entities.filter((e) => !batch.entities?.some((b) => b.id === e.id)).concat(batch.entities ?? [])
  catalog.progressions.push(...(batch.progressions ?? []))
  catalog.relations.push(...(batch.relations ?? []))
}
for (const f of ['content/srd/races.json', 'content/srd/rules.json']) add(read(R + f))
for (const f of readdirSync(R + 'content/srd/classes')) add(read(R + 'content/srd/classes/' + f))

const ids = new Set()
for (const file of files) {
  if (!existsSync(file)) { problems.push(`${file}: missing`); continue }
  let batch
  try { batch = read(file) } catch (e) { problems.push(`${file}: not JSON: ${e.message}`); continue }
  // domains.json: domain entities plus their relations (spells on the domain list, class skills).
  const domains = file.endsWith('domains.json')
  for (const e of batch.entities ?? []) {
    const at = `${file.split('/').pop()} ${e.id}`
    if (ids.has(e.id)) problems.push(`${at}: duplicate id`)
    ids.add(e.id)
    const type = domains ? 'domain' : 'spell'
    if (!new RegExp(`^${type}\\.[a-z0-9_]+$`).test(e.id ?? '')) problems.push(`${at}: id must be ${type}.<lowercase english name>`)
    if (e.type !== type) problems.push(`${at}: type must be ${type}`)
    if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
    if (e.provenance !== 'official') problems.push(`${at}: provenance must be official`)
    if (!domains && !e.labels?.includes('spell')) problems.push(`${at}: labels must include "spell" and the school`)
    const d = e.description?.fr ?? ''
    if (!/\n\nEn jeu\n• /.test(d)) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) problems.push(`${at}: unexpected field ${k}`)
    for (const k of Object.keys(e.spell ?? {})) if (!SPELL_KEYS.has(k)) problems.push(`${at}: unexpected spell field ${k}`)
    if (!domains && !e.spell?.school) problems.push(`${at}: spell.school missing`)
    if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  }
  if (!domains && (batch.relations?.length || batch.progressions?.length)) problems.push(`${file}: entities only (relations come from lists.json)`)
  add(batch)
}
// Relations must point at entities that exist (spells from every batch, classes, skills, domains).
const known = new Set(catalog.entities.map((e) => e.id))
for (const f of readdirSync(R + 'content/srd/spells')) for (const e of read(R + 'content/srd/spells/' + f).entities ?? []) known.add(e.id)
for (const file of files.filter((f) => f.endsWith('domains.json') && existsSync(f))) {
  for (const r of read(file).relations ?? []) for (const id of [r.from, r.to]) if (!known.has(id)) problems.push(`domains.json relation ${r.from} -> ${r.to}: unknown ${id}`)
}

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine) {
  const character = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 },
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, classId: 'class.wizard', classLevel: i + 1 })),
    activeToggles: [...ids].map((id) => ({ toggle: 'toggle.' + id.slice(6) })) }
  const sheet = engine.open(JSON.stringify(character), 20)
  for (const issue of sheet.issues.asJsReadonlyArrayView()) if ([...ids].some((id) => issue.includes(id + '/') || issue.includes(id + ' ') || issue.includes(id + "'"))) problems.push(`engine: ${issue}`)
}
console.log(problems.length ? problems.join('\n') : `OK: ${ids.size} spells`)
process.exit(problems.length ? 1 : 0)

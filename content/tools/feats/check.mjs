// Checks feat batches: house format, ids, `requires` relations, strict engine decoding, formulas, and each feat's
// numbers on a test character (a Human Fighter 10 / Wizard 10; the feat alone, every toggle on).
// Usage: node content/tools/feats/check.mjs content/srd/feats/<batch>.json...
import { readFileSync, readdirSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const files = process.argv.slice(2)
const problems = []
const warnings = []
const CATEGORIES = ['general', 'metamagic', 'item_creation', 'monster', 'epic']
const ENTITY_KEYS = new Set(['id', 'type', 'name', 'provenance', 'source', 'labels', 'description', 'prerequisite', 'effects', 'usesPerDay', 'note', 'status'])

const catalog = read(R + 'test-references/danalieth/catalog.json')
const add = (batch) => {
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  const classes = new Set((batch.progressions ?? []).map((p) => p.classId))
  const froms = new Set([...ids, ...(batch.relations ?? []).map((r) => r.from)])
  catalog.entities = catalog.entities.filter((e) => !ids.has(e.id)).concat(batch.entities ?? [])
  // Same replacement rules as `server import`: rows of the file's classes and relations from the file's ids.
  catalog.progressions = catalog.progressions.filter((p) => !classes.has(p.classId)).concat(batch.progressions ?? [])
  if (batch.relations) catalog.relations = catalog.relations.filter((r) => !froms.has(r.from)).concat(batch.relations)
}
const dir = (d) => readdirSync(R + d).filter((f) => f.endsWith('.json')).map((f) => d + '/' + f)
const resolved = new Set(files.map((f) => new URL(f, 'file://' + process.cwd() + '/').pathname))
const others = dir('content/srd/feats').filter((f) => !resolved.has(R + f))
for (const f of ['content/srd/races.json', 'content/srd/rules.json', 'content/srd/domains.json', ...dir('content/srd/classes'), ...dir('content/srd/prestige'), ...dir('content/srd/spells'), ...dir('content/srd/equipment'), ...others]) add(read(R + f))

const mine = []
for (const file of files) {
  const batch = read(file)
  const at0 = file.split('/').pop()
  for (const e of batch.entities ?? []) {
    const at = `${at0} ${e.id}`
    mine.push(e)
    if (!/^feat\.[a-z0-9_]+$/.test(e.id ?? '')) problems.push(`${at}: id must be feat.<lowercase english name>`)
    if (e.type !== 'feat') problems.push(`${at}: type must be feat`)
    if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
    if (!['official', 'team'].includes(e.provenance)) problems.push(`${at}: provenance must be official`)
    if (!CATEGORIES.some((c) => e.labels?.includes(c))) problems.push(`${at}: labels must include one of ${CATEGORIES.join(', ')}`)
    if (!/\n\nEn jeu\n• /.test(e.description?.fr ?? '')) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) problems.push(`${at}: unexpected field ${k}`)
    if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  }
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  for (const r of batch.relations ?? []) {
    if (!ids.has(r.from)) problems.push(`${at0}: relation from ${r.from}: only relations from this file's feats`)
    if (r.relation !== 'requires') problems.push(`${at0}: relation ${r.relation}: only "requires" (feat -> feat it needs)`)
  }
  if (batch.progressions?.length) problems.push(`${at0}: no progressions in feat batches`)
  add(batch)
}

// Feats written later by other chunks are known by id (content/tools/out/feat-chunks/ids.json), so a `requires` to one
// of them is only a warning until its batch exists.
const known = new Set(catalog.entities.map((e) => e.id))
let planned = new Set()
try { planned = new Set(Object.values(read(R + 'content/tools/out/feat-chunks/ids.json'))) } catch {}
for (const e of mine) {
  for (const id of JSON.stringify([e.prerequisite, e.effects]).match(/'(feat|class|power|spell|skill|item)\.[a-z0-9_]+'/g) ?? []) {
    const ref = id.slice(1, -1)
    if (!known.has(ref)) (planned.has(ref) ? warnings : problems).push(`${e.id}: unknown ${ref}${planned.has(ref) ? ' (planned in another chunk)' : ''}`)
  }
}
for (const file of files) for (const r of read(file).relations ?? []) if (!known.has(r.to)) (planned.has(r.to) ? warnings : problems).push(`relation ${r.from} -> ${r.to}: unknown target`)

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine) {
  const levels = [...Array.from({ length: 10 }, (_, i) => ({ level: i + 1, classId: 'class.fighter', classLevel: i + 1 })),
    ...Array.from({ length: 10 }, (_, i) => ({ level: 11 + i, classId: 'class.wizard', classLevel: i + 1 }))]
  const base = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 12 } }
  const open = (gained) => {
    const sheet = engine.open(JSON.stringify({ ...base, levels: levels.map((l, i) => (i ? l : { ...l, gained })), choices: Object.fromEntries(gained.map((g) => [g, 'class.wizard'])) }), levels.length)
    for (const t of sheet.toggles.asJsReadonlyArrayView()) sheet.setToggleChoice(JSON.stringify({ toggle: t.id, value: 2 }))
    return sheet
  }
  const plain = open([])
  for (const e of mine) {
    const sheet = open([e.id])
    for (const issue of sheet.issues.asJsReadonlyArrayView()) if (issue.includes(e.id)) problems.push(`engine: ${issue}`)
    const targets = [...new Set((e.effects ?? []).filter((x) => x.scope !== 'spell').map((x) => x.target))]
    const changes = targets.map((k) => `${k} ${plain.statistic(k)?.text ?? '-'} -> ${sheet.statistic(k)?.text ?? '-'}`)
    const failed = sheet.prerequisites.asJsReadonlyArrayView().filter((p) => p.entity === e.id).flatMap((p) => [...p.failed.asJsReadonlyArrayView(), ...p.unknown.asJsReadonlyArrayView().map((u) => 'cannot check ' + u)])
    const spell = (e.effects ?? []).filter((x) => x.scope === 'spell').map((x) => `${x.target} ${x.op} ${x.value}`)
    console.log(`${e.id}: ${[...changes, ...spell.map((s) => 'spell ' + s)].join('; ') || 'no effects'}${failed.length ? ` | prerequisite fails on the test sheet: ${failed.join(', ')}` : ''}`)
  }
}
for (const w of warnings) console.log('warning: ' + w)
console.log(problems.length ? problems.join('\n') : `OK: ${mine.length} feats`)
process.exit(problems.length ? 1 : 0)

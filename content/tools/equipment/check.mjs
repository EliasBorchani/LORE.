// Checks equipment batches: house format, the table data built by prepare.py kept as is, strict engine decoding,
// formulas, and each item's numbers on a test character (a Human Fighter 10, the item alone equipped, toggles on).
// Usage: node content/tools/equipment/check.mjs content/srd/equipment/<batch>.json...
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const files = process.argv.slice(2)
const problems = []
const ENTITY_KEYS = new Set(['id', 'type', 'name', 'provenance', 'source', 'labels', 'description', 'item', 'effects', 'usesPerDay', 'note', 'status'])

const catalog = read(R + 'test-references/danalieth/catalog.json')
const add = (batch) => {
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  const froms = new Set([...ids, ...(batch.relations ?? []).map((r) => r.from)])
  catalog.entities = catalog.entities.filter((e) => !ids.has(e.id)).concat(batch.entities ?? [])
  // Same replacement rules as `server import`: relations from the file's ids.
  if (batch.relations) catalog.relations = catalog.relations.filter((r) => !froms.has(r.from)).concat(batch.relations)
}
const dir = (d) => existsSync(R + d) ? readdirSync(R + d).filter((f) => f.endsWith('.json')).map((f) => d + '/' + f) : []
const resolved = new Set(files.map((f) => new URL(f, 'file://' + process.cwd() + '/').pathname))
const others = dir('content/srd/equipment').filter((f) => !resolved.has(R + f))
for (const f of ['content/srd/races.json', 'content/srd/rules.json', 'content/srd/domains.json', ...dir('content/srd/classes'),
  ...dir('content/srd/prestige'), ...dir('content/srd/spells'), ...dir('content/srd/feats'), ...others]) add(read(R + f))

// The table data of every item, as prepare.py built it.
const skeletons = new Map()
const chunks = R + 'content/tools/out/equipment-chunks/'
for (const f of readdirSync(chunks).filter((f) => /^\d+\.json$/.test(f))) for (const it of read(chunks + f).items) skeletons.set(it.skeleton.id, it.skeleton)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const mine = []
for (const file of files) {
  const batch = read(file)
  const at0 = file.split('/').pop()
  for (const e of batch.entities ?? []) {
    const at = `${at0} ${e.id}`
    mine.push(e)
    const s = skeletons.get(e.id)
    if (!s) { problems.push(`${at}: unknown id (ids come from prepare.py)`); continue }
    for (const k of ['type', 'provenance']) if (e[k] !== s[k]) problems.push(`${at}: ${k} must stay ${s[k]}`)
    if (e.name?.en !== s.name.en || !e.name?.fr) problems.push(`${at}: name.en must stay "${s.name.en}", name.fr needed`)
    for (const l of s.labels) if (!e.labels?.includes(l)) problems.push(`${at}: label ${l} missing`)
    for (const [k, v] of Object.entries(s.item)) if (e.item?.[k] !== v) problems.push(`${at}: item.${k} must stay "${v}"`)
    const fixed = s.effects ?? []
    if (!same((e.effects ?? []).slice(0, fixed.length), fixed)) problems.push(`${at}: the table effects must come first, unchanged`)
    if (!/\n\nEn jeu\n• /.test(e.description?.fr ?? '')) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) problems.push(`${at}: unexpected field ${k}`)
    if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  }
  if (batch.relations?.length || batch.progressions?.length) problems.push(`${at0}: entities only`)
  add(batch)
}

const known = new Set(catalog.entities.map((e) => e.id))
for (const e of mine) {
  for (const id of JSON.stringify(e.effects ?? []).match(/'(feat|class|power|spell|skill|item|race)\.[a-z0-9_]+'/g) ?? []) {
    if (!known.has(id.slice(1, -1))) problems.push(`${e.id}: unknown ${id}`)
  }
}

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine) {
  const levels = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, classId: 'class.fighter', classLevel: i + 1 }))
  const base = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 16, dex: 18, con: 14, int: 10, wis: 12, cha: 10 }, levels }
  const open = (items) => {
    const sheet = engine.open(JSON.stringify({ ...base, items: items.map((id) => ({ id, equipped: true })) }), levels.length)
    for (const t of sheet.toggles.asJsReadonlyArrayView()) sheet.setToggleChoice(JSON.stringify({ toggle: t.id, value: 2 }))
    return sheet
  }
  const plain = open([])
  const SHOW = ['weapon.damage', 'weapon.threat_range', 'weapon.crit_multiplier', 'ac.total', 'ac.dex_bonus', 'armor.check_penalty', 'spell_failure.arcane', 'damage.melee']
  for (const e of mine) {
    const sheet = open([e.id])
    for (const issue of sheet.issues.asJsReadonlyArrayView()) if (issue.includes(e.id)) problems.push(`engine: ${issue}`)
    const keys = [...new Set([...SHOW, ...(e.effects ?? []).map((x) => x.target)])]
    const changes = keys.map((k) => [k, plain.statistic(k)?.text ?? '-', sheet.statistic(k)?.text ?? '-']).filter(([, a, b]) => a !== b)
    const situational = (e.effects ?? []).filter((x) => x.situation).map((x) => `${x.target} ${x.value} (${x.situation})`)
    console.log(`${e.id}: ${[...changes.map(([k, a, b]) => `${k} ${a} -> ${b}`), ...situational].join('; ') || 'no numbers'}`)
  }
}
console.log(problems.length ? problems.join('\n') : `OK: ${mine.length} items`)
process.exit(problems.length ? 1 : 0)

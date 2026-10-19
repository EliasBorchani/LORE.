// Checks a prestige class batch: house format, strict engine decoding, formulas, relation targets, and the class
// computed on a test character (a Human with 10 Fighter levels, then the prestige class to its last row).
// Usage: node content/tools/prestige/check.mjs content/srd/prestige/<class>.json
import { readFileSync, readdirSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const file = process.argv[2]
const problems = []
const warnings = []

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
for (const f of ['content/srd/races.json', 'content/srd/rules.json', 'content/srd/domains.json', ...dir('content/srd/classes'), ...dir('content/srd/spells'), ...dir('content/srd/equipment')]) add(read(R + f))

const batch = read(file)
const cls = (batch.entities ?? []).filter((e) => e.type === 'prestige_class')
if (cls.length !== 1) problems.push('exactly one prestige_class entity expected')
const classId = cls[0]?.id
for (const e of batch.entities ?? []) {
  const at = e.id
  if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
  if (!/\n\nEn jeu\n• /.test(e.description?.fr ?? '')) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
  if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  if (e.type === 'class_power' && !e.id.startsWith(`power.${classId?.slice(6)}_`)) problems.push(`${at}: class powers are power.<class>_<feature>`)
}
for (const r of batch.relations ?? []) if (r.from?.startsWith('spell.')) problems.push(`relation from ${r.from}: spell list entries go in the result, not in this file (lists.json owns them)`)
const rows = (batch.progressions ?? []).filter((p) => p.classId === classId).sort((a, b) => a.level - b.level)
if (!rows.length) problems.push('no progression rows')
rows.forEach((r, i) => { if (r.level !== i + 1) problems.push(`row ${i + 1}: levels must be 1..N without gaps`) })
add(batch)

const known = new Set(catalog.entities.map((e) => e.id))
for (const r of batch.relations ?? []) for (const id of [r.from, r.to]) if (!known.has(id)) warnings.push(`relation ${r.from} -> ${r.to}: unknown ${id} (report it as missing shared entity)`)
for (const r of rows) for (const g of r.grants ?? []) if (!known.has(g)) problems.push(`row ${r.level}: grants unknown ${g}`)

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine && classId && rows.length) {
  const levels = [...Array.from({ length: 10 }, (_, i) => ({ level: i + 1, classId: 'class.fighter', classLevel: i + 1 })),
    ...rows.map((r) => ({ level: 10 + r.level, classId, classLevel: r.level }))]
  const character = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 }, levels }
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  const sheet = engine.open(JSON.stringify(character), levels.length)
  const toggles = sheet.toggles.asJsReadonlyArrayView().map((t) => t.id)
  for (const t of toggles) sheet.setToggleChoice(JSON.stringify({ toggle: t }))
  for (const issue of sheet.issues.asJsReadonlyArrayView()) if ([...ids].some((id) => issue.includes(id))) problems.push(`engine: ${issue}`)
  const show = ['bab', 'save.fort', 'save.ref', 'save.will', 'ac.total', 'attack.melee', 'damage.melee']
  console.log(`test sheet (Fighter 10 + ${classId} ${rows.length}, every toggle on): ` + show.map((k) => `${k}=${sheet.statistic(k)?.text}`).join(' '))
  console.log('toggles: ' + (toggles.join(' ') || 'none') + ' | uses: ' + sheet.dailyUses.asJsReadonlyArrayView().map((u) => `${u.entity}=${u.uses}`).join(' '))
}
for (const w of warnings) console.log('warning: ' + w)
console.log(problems.length ? problems.join('\n') : `OK: ${classId}, ${(batch.entities ?? []).length} entities, ${rows.length} rows`)
process.exit(problems.length ? 1 : 0)

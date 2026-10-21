// Checks Tome of Battle batches (content/srd/tob/): house format, the `maneuver` block as prepare.py built it, then
// strict engine decoding and formula checks with every maneuver and toggle on a test sheet.
// Usage (from anywhere): node check.mjs <batch.json>...
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const files = process.argv.slice(2)
const problems = []
const ENTITY_KEYS = new Set(['id', 'type', 'name', 'provenance', 'source', 'labels', 'description', 'maneuver', 'effects', 'tableValue', 'usesPerDay', 'note'])
const LABELS = new Set(['strike', 'boost', 'counter', 'supernatural'])
const DISCIPLINES = ['desert_wind', 'devoted_spirit', 'diamond_mind', 'iron_heart', 'setting_sun', 'shadow_hand', 'stone_dragon', 'tiger_claw', 'white_raven'].map((d) => 'discipline.' + d)

const catalog = read(R + 'test-references/danalieth/catalog.json')
const add = (batch) => {
  catalog.entities = catalog.entities.filter((e) => !batch.entities?.some((b) => b.id === e.id)).concat(batch.entities ?? [])
  catalog.progressions.push(...(batch.progressions ?? []))
  catalog.relations.push(...(batch.relations ?? []))
}
for (const f of ['content/srd/races.json', 'content/srd/rules.json', 'content/srd/situations.json', 'content/srd/tob/core.json']) add(read(R + f))
for (const f of readdirSync(R + 'content/srd/classes')) add(read(R + 'content/srd/classes/' + f))
const situations = new Set(read(R + 'content/srd/situations.json').entities.map((e) => e.id))
// Situations the writers propose (`content/tools/out/tob/situations-*.json`: [[id, fr, en], …]), merged into
// content/tools/catalog/situations.mjs once reviewed.
const proposals = R + 'content/tools/out/tob'
if (existsSync(proposals)) {
  for (const f of readdirSync(proposals).filter((f) => /^situations-.*\.json$/.test(f))) {
    for (const [id] of read(`${proposals}/${f}`)) {
      situations.add(`situation.${id}`)
      catalog.entities.push({ id: `situation.${id}`, type: 'situation', name: { fr: id } })
    }
  }
}

// Effect targets must be statistics the content already uses (or core ones): a typo would make a new, unread one.
const targets = new Set(catalog.statistics.map((s) => s.key))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : d.name.endsWith('.json') ? [`${dir}/${d.name}`] : []))
for (const f of [...walk(R + 'content/srd').filter((f) => !f.includes('/tob/maneuvers')), R + 'test-references/danalieth/catalog.json']) {
  for (const e of read(f).entities ?? []) for (const effect of e.effects ?? []) targets.add(effect.target)
}

// What prepare.py built, when its output is still here (content/tools/out is git-ignored).
const prepared = new Map()
const chunks = R + 'content/tools/out/tob/chunks'
if (existsSync(chunks)) for (const f of readdirSync(chunks)) for (const e of read(`${chunks}/${f}`)) prepared.set(e.id, e)

const ids = new Set()
const toggles = []
for (const file of files) {
  if (!existsSync(file)) { problems.push(`${file}: missing`); continue }
  let batch
  try { batch = read(file) } catch (e) { problems.push(`${file}: not JSON: ${e.message}`); continue }
  if (batch.relations?.length || batch.progressions?.length) problems.push(`${file}: entities only`)
  for (const e of batch.entities ?? []) {
    const at = `${file.split('/').pop()} ${e.id}`
    if (ids.has(e.id)) problems.push(`${at}: duplicate id`)
    ids.add(e.id)
    if (!/^(maneuver|stance)\.[a-z0-9_]+$/.test(e.id ?? '')) problems.push(`${at}: id must be maneuver.<name> or stance.<name>`)
    if (e.type !== e.id?.split('.')[0]) problems.push(`${at}: type must match the id prefix`)
    if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
    if (e.provenance !== 'official') problems.push(`${at}: provenance must be official`)
    if (e.source !== 'Book of Nine Swords') problems.push(`${at}: source must be "Book of Nine Swords"`)
    for (const l of e.labels ?? []) if (!LABELS.has(l)) problems.push(`${at}: label ${l} not in ${[...LABELS]}`)
    const d = e.description?.fr ?? ''
    if (!/^[^\n]+\n\nEn jeu\n• /.test(d)) problems.push(`${at}: description.fr must be one paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
    if (d.length > 1400) problems.push(`${at}: description too long (${d.length}): short summaries only`)
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) problems.push(`${at}: unexpected field ${k}`)
    const m = e.maneuver ?? {}
    if (!DISCIPLINES.includes(m.discipline)) problems.push(`${at}: maneuver.discipline must be one of the nine`)
    if (!(m.level >= 1 && m.level <= 9)) problems.push(`${at}: maneuver.level 1 to 9`)
    if ((m.kind === 'stance') !== (e.type === 'stance')) problems.push(`${at}: kind stance if and only if type stance`)
    const p = prepared.get(e.id)
    if (prepared.size && !p) problems.push(`${at}: not an id prepare.py made`)
    if (p) {
      if (JSON.stringify(m) !== JSON.stringify(p.maneuver)) problems.push(`${at}: maneuver block changed from prepare.py's`)
      if (e.name.en !== p.en) problems.push(`${at}: name.en must be "${p.en}"`)
      if (JSON.stringify(e.labels ?? []) !== JSON.stringify(p.labels)) problems.push(`${at}: labels must be ${JSON.stringify(p.labels)}`)
    }
    const own = `toggle.${e.id.split('.')[1]}`
    for (const effect of e.effects ?? []) {
      for (const t of (effect.condition ?? '').matchAll(/active\('([^']+)'\)/g)) {
        if (t[1] !== own) problems.push(`${at}: its toggle is ${own}, not ${t[1]}`)
        toggles.push(t[1])
      }
      if (!targets.has(effect.target) && !/^damage_reduction\.[a-z_]+$/.test(effect.target)) problems.push(`${at}: unknown target ${effect.target}`)
      if (effect.situation && !situations.has(effect.situation)) problems.push(`${at}: unknown situation ${effect.situation}`)
    }
    if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  }
  add(batch)
}

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine) {
  // Every maneuver had at once (gained at level 1) with every toggle on: formulas, targets and bonus types resolve.
  const character = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 16, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, classId: 'class.fighter', classLevel: i + 1, gained: i === 0 ? [...ids] : [] })),
    activeToggles: [...new Set(toggles)].map((toggle) => ({ toggle })) }
  const sheet = engine.open(JSON.stringify(character), 20)
  for (const issue of sheet.issues.asJsReadonlyArrayView()) if ([...ids].some((id) => issue.includes(id + '/') || issue.includes(id + ' ') || issue.includes(id + "'"))) problems.push(`engine: ${issue}`)
}
console.log(problems.length ? problems.join('\n') : `OK: ${ids.size} maneuvers and stances`)
process.exit(problems.length ? 1 : 0)

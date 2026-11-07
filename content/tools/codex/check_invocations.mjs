// Checks warlock invocation batches (content/srd/arcane/invocations-NN.json): house format, the `invocation` block,
// strict engine decoding, and each invocation's numbers on a test Warlock 20 who knows it (every toggle on).
// Usage: node content/tools/codex/check_invocations.mjs content/srd/arcane/invocations-01.json...
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const files = process.argv.slice(2)
const problems = []
const ENTITY_KEYS = new Set(['id', 'type', 'name', 'provenance', 'source', 'labels', 'description', 'invocation', 'effects', 'usesPerDay', 'tableValue', 'note', 'status'])
const BLOCK_KEYS = new Set(['grade', 'level', 'kind', 'action', 'range', 'target', 'area', 'effect', 'duration', 'savingThrow', 'spellResistance'])
const GRADES = ['least', 'lesser', 'greater', 'dark']
const KINDS = ['essence', 'blast_shape', 'other']

const catalog = { ...read(R + 'content/srd/core.json'), ...read(R + 'test-references/danalieth/catalog.json') }
const add = (batch) => {
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  const classes = new Set((batch.progressions ?? []).map((p) => p.classId))
  const froms = new Set([...ids, ...(batch.relations ?? []).map((r) => r.from)])
  catalog.entities = catalog.entities.filter((e) => !ids.has(e.id)).concat(batch.entities ?? [])
  catalog.progressions = catalog.progressions.filter((p) => !classes.has(p.classId)).concat(batch.progressions ?? [])
  if (batch.relations) catalog.relations = catalog.relations.filter((r) => !froms.has(r.from)).concat(batch.relations)
}
const dir = (d) => existsSync(R + d) ? readdirSync(R + d).filter((f) => f.endsWith('.json')).map((f) => d + '/' + f) : []
const resolved = new Set(files.map((f) => new URL(f, 'file://' + process.cwd() + '/').pathname))
for (const f of ['content/srd/races.json', 'content/srd/rules.json', 'content/srd/situations.json', ...dir('content/srd/classes'), ...dir('content/srd/feats'), ...dir('content/srd/spells'), ...dir('content/srd/arcane')]) {
  if (!resolved.has(R + f)) add(read(R + f))
}

const mine = []
const seen = new Set()
for (const file of files) {
  const batch = read(file)
  const at0 = file.split('/').pop()
  for (const e of batch.entities ?? []) {
    const at = `${at0} ${e.id}`
    mine.push(e)
    if (seen.has(e.id)) problems.push(`${at}: duplicate id`)
    seen.add(e.id)
    if (!/^invocation\.[a-z0-9_]+$/.test(e.id ?? '')) problems.push(`${at}: id must be invocation.<lowercase english name>`)
    if (e.type !== 'invocation') problems.push(`${at}: type must be invocation`)
    if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
    if (e.provenance !== 'official') problems.push(`${at}: provenance must be official`)
    if (e.source !== 'Complete Arcane') problems.push(`${at}: source must be Complete Arcane`)
    const b = e.invocation ?? {}
    if (!GRADES.includes(b.grade)) problems.push(`${at}: invocation.grade must be one of ${GRADES.join(', ')}`)
    if (!Number.isInteger(b.level) || b.level < 1 || b.level > 9) problems.push(`${at}: invocation.level must be the spell level equivalent, 1 to 9`)
    if (b.kind && !KINDS.includes(b.kind)) problems.push(`${at}: invocation.kind must be one of ${KINDS.join(', ')}`)
    for (const k of Object.keys(b)) if (!BLOCK_KEYS.has(k)) problems.push(`${at}: unexpected invocation field ${k}`)
    if (!e.labels?.includes('invocation') || !e.labels?.includes(b.grade)) problems.push(`${at}: labels must include "invocation" and the grade`)
    if (!/\n\nEn jeu\n• /.test(e.description?.fr ?? '')) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) problems.push(`${at}: unexpected field ${k}`)
    if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  }
  if (batch.relations?.length || batch.progressions?.length) problems.push(`${at0}: entities only`)
  add(batch)
}

const known = new Set(catalog.entities.map((e) => e.id))
for (const e of mine) {
  for (const ref of JSON.stringify(e.effects ?? []).match(/(situation|feat|class|spell|power)\.[a-z0-9_]+/g) ?? []) {
    if (!known.has(ref)) problems.push(`${e.id}: unknown ${ref}`)
  }
}

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
const warlock = catalog.entities.some((e) => e.id === 'class.warlock')
if (engine && warlock) {
  const levels = Array.from({ length: 20 }, (_, i) => ({ level: i + 1, classId: 'class.warlock', classLevel: i + 1 }))
  const base = { id: 'char.check', name: 'Check', race: 'race.human', baseAbilities: { str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 18 }, levels }
  const open = (known) => {
    const sheet = engine.open(JSON.stringify({ ...base, invocations: { 'class.warlock': { known } } }), 20)
    for (const t of sheet.toggles.asJsReadonlyArrayView()) sheet.setToggleChoice(JSON.stringify({ toggle: t.id, value: 2 }))
    return sheet
  }
  const plain = open([])
  for (const e of mine) {
    const sheet = open([e.id])
    for (const issue of sheet.issues.asJsReadonlyArrayView()) if (issue.includes(e.id)) problems.push(`engine: ${issue}`)
    const line = sheet.invokers.asJsReadonlyArrayView()[0]
    for (const i of line?.issues.asJsReadonlyArrayView() ?? []) if (i.entity === e.id) problems.push(`${e.id}: invoker issue ${i.code}`)
    const targets = [...new Set((e.effects ?? []).map((x) => x.target))]
    const changes = targets.map((k) => `${k} ${plain.statistic(k)?.text ?? '-'} -> ${sheet.statistic(k)?.text ?? '-'}`)
    console.log(`${e.id}: ${changes.join('; ') || 'no effects'}`)
  }
} else if (engine) {
  console.log('note: class.warlock not in content/srd/classes yet; effects not computed on a test sheet')
}
console.log(problems.length ? problems.join('\n') : `OK: ${mine.length} invocations`)
process.exit(problems.length ? 1 : 0)

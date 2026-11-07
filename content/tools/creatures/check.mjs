// Checks a creature batch: house format, strict engine decoding, then each creature taken as a form by a Human druid
// 25 (Shapechange, so any kind up to 25 HD) at its own hit dice and at the most its advancement allows. Prints the
// computed form for review against the book, and what Wild Shape (or Elemental Wild Shape) would refuse.
// Usage: node content/tools/creatures/check.mjs content/srd/creatures/<batch>.json
import { readFileSync, readdirSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { SheetEngine, ContentCheck } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const file = process.argv[2]
const problems = []
const list = (k) => k.asJsReadonlyArrayView()

const SIZES = ['fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal']
const KINDS = ['aberration', 'animal', 'construct', 'dragon', 'elemental', 'fey', 'giant', 'humanoid', 'magical_beast',
  'monstrous_humanoid', 'ooze', 'outsider', 'plant', 'undead', 'vermin']

const core = { ...read(R + 'content/srd/core.json'), ...read(R + 'test-references/danalieth/catalog.json') }
const catalog = structuredClone(core)
const add = (batch) => {
  const ids = new Set((batch.entities ?? []).map((e) => e.id))
  catalog.entities = catalog.entities.filter((e) => !ids.has(e.id)).concat(batch.entities ?? [])
  catalog.progressions = catalog.progressions.filter((p) => !(batch.progressions ?? []).some((b) => b.classId === p.classId)).concat(batch.progressions ?? [])
  const froms = new Set([...ids, ...(batch.relations ?? []).map((r) => r.from)])
  if (batch.relations) catalog.relations = catalog.relations.filter((r) => !froms.has(r.from)).concat(batch.relations)
}
const dir = (d) => readdirSync(R + d).filter((f) => f.endsWith('.json')).map((f) => d + '/' + f)
const self = new URL(file, 'file://' + process.cwd() + '/').pathname
for (const f of ['content/srd/races.json', 'content/srd/rules.json', ...dir('content/srd/classes'), ...dir('content/srd/spells'), ...dir('content/srd/feats'), ...dir('content/srd/creatures')]) {
  if (R + f === self) continue
  // Other creature batches may be half written while their agent works: skip what does not parse yet.
  try { add(read(R + f)) } catch (e) { if (!f.includes('/creatures/')) throw e }
}
const batch = read(file)
add(batch)

const sections = Object.fromEntries(Object.entries(core).filter(([k]) => k !== 'entities'))
const seen = new Set()
for (const e of batch.entities ?? []) {
  const at = e.id
  if (seen.has(e.id)) problems.push(`${at}: duplicate id`)
  seen.add(e.id)
  if (!/^creature\.[a-z0-9_]+$/.test(e.id)) problems.push(`${at}: ids are creature.<english_name>`)
  if (e.type !== 'creature') problems.push(`${at}: type must be creature`)
  if (!e.name?.fr || !e.name?.en) problems.push(`${at}: name.fr and name.en needed`)
  if (e.provenance !== 'official' || !e.source) problems.push(`${at}: provenance official and a source needed`)
  if (!/\n\nEn jeu\n• /.test(e.description?.fr ?? '')) problems.push(`${at}: description.fr must be a paragraph, then "\\n\\nEn jeu\\n• rule" lines`)
  if (/https?:\/\//.test(JSON.stringify(e))) problems.push(`${at}: no URLs`)
  const c = e.creature
  if (!c) { problems.push(`${at}: creature block missing`); continue }
  if (!(e.labels ?? []).includes('creature') || !(e.labels ?? []).includes(c.kind)) problems.push(`${at}: labels need "creature" and the kind`)
  if (!KINDS.includes(c.kind)) problems.push(`${at}: unknown kind ${c.kind}`)
  for (const a of ['wis', 'cha']) if (typeof c.abilities?.[a] !== 'number') problems.push(`${at}: abilities.${a} missing`)
  for (const a of c.attacks ?? []) {
    if (!a.name?.fr || !a.name?.en) problems.push(`${at}: attack ${a.id} needs name.fr and name.en`)
    if (/[+-]\s*\d+\s*$/.test(a.dice)) problems.push(`${at}: attack ${a.id} dice "${a.dice}" must not include the Strength bonus`)
  }
  let last = c.hitDice
  for (const b of c.advancement ?? []) {
    if (b.maxHd <= last) problems.push(`${at}: advancement bands must go up (${b.maxHd} after ${last})`)
    if (SIZES.indexOf(b.size) < SIZES.indexOf(c.size)) problems.push(`${at}: an advancement band cannot be smaller than the creature`)
    last = b.maxHd
  }
  const { note, status, flag, assumptions, ...clean } = e
  for (const issue of list(ContentCheck.getInstance().entity(JSON.stringify(clean), JSON.stringify(sections)))) {
    problems.push(`${at}: ${issue.code} ${issue.at} ${issue.message}`)
  }
}

let engine
try { engine = new SheetEngine(JSON.stringify(catalog)) } catch (e) { problems.push(`engine refused the catalog: ${e.message ?? e}`) }
if (engine) {
  const levels = Array.from({ length: 25 }, (_, i) => ({ level: i + 1, classId: 'class.druid', classLevel: i + 1 }))
  for (const e of batch.entities ?? []) {
    const c = e.creature
    if (!c) continue
    const wild = c.kind === 'elemental' ? 'power.druid_elemental_wild_shape' : 'power.druid_wild_shape'
    const top = Math.max(c.hitDice, ...(c.advancement ?? []).map((b) => b.maxHd))
    for (const hd of [...new Set([c.hitDice, top])]) {
      const forms = [
        { id: 'form.test', creature: e.id, source: 'spell.shapechange', hitDice: hd, abilityIncreases: Array(12).fill('str') },
        { id: 'form.wild', creature: e.id, source: wild, hitDice: hd },
      ]
      const character = {
        id: 'char.check', name: 'Check', race: 'race.human',
        baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        levels, forms, activeToggles: [{ toggle: 'toggle.form', form: 'form.test' }],
      }
      const sheet = engine.open(JSON.stringify(character), 0)
      for (const issue of list(sheet.issues)) if (issue.includes(e.id) || issue.includes('natural.')) problems.push(`${e.id} (${hd} HD): ${issue}`)
      const f = sheet.activeForm
      if (!f) { problems.push(`${e.id}: no active form`); continue }
      for (const i of list(f.issues)) if (!['unspent', 'too_many_increases'].includes(i)) problems.push(`${e.id} (${hd} HD): ${i}`)
      const wildIssues = list(list(sheet.forms).find((x) => x.id === 'form.wild').issues).filter((i) => i !== 'unspent')
      const v = (k) => sheet.statistic(k)?.text
      const attacks = list(f.naturalAttacks).map((a) => `${a.count > 1 ? a.count + ' ' : ''}${a.id}${a.primary ? '' : '*'} ${a.attack} (${a.damage})`).join(', ')
      console.log(`${e.id} ${f.hitDice} HD ${f.size}: Str ${f.str ?? '—'} Dex ${f.dex ?? '—'} Con ${f.con ?? '—'} NA ${f.naturalArmor} | ${attacks}` +
        ` | speed ${['land', 'fly', 'swim', 'climb', 'burrow'].map((m) => c.speeds?.[m] ? `${m} ${v('speed.' + m)}` : null).filter(Boolean).join(' ')}` +
        (wildIssues.length ? ` | wild shape: ${wildIssues.join(' ')}` : ''))
    }
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log('- ' + p)
  process.exit(1)
}
console.log(`\nOK: ${(batch.entities ?? []).length} creatures`)

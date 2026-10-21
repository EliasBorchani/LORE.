// Checks the books and situations batches: ids and types, names (a situation in French and English, a book by its
// English title), no duplicates, strict engine decoding, and that every situation the official content names has
// its entry. Usage: node content/tools/catalog/check.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
const R = new URL('../../../', import.meta.url).pathname
const { ContentCheck } = await import(R + 'apps/web/node_modules/dnd-engine/dnd-engine.mjs')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const core = JSON.stringify((({ entities, ...sections }) => sections)(read(R + 'test-references/danalieth/catalog.json')))
const problems = []

const KINDS = { source: { file: 'sources.json', names: ['en'] }, situation: { file: 'situations.json', names: ['fr', 'en'] } }
for (const [type, { file, names }] of Object.entries(KINDS)) {
  const seen = new Set()
  for (const e of read(R + 'content/srd/' + file).entities) {
    const at = `${file} ${e.id}`
    if (e.type !== type || !new RegExp(`^${type}\\.[a-z0-9_]+$`).test(e.id)) problems.push(`${at}: id or type`)
    if (seen.has(e.id)) problems.push(`${at}: twice`)
    seen.add(e.id)
    for (const lang of names) if (!e.name?.[lang]) problems.push(`${at}: no ${lang} name`)
    for (const issue of ContentCheck.getInstance().entity(JSON.stringify(e), core).asJsReadonlyArrayView()) problems.push(`${at}: ${issue.code} ${issue.message}`)
  }
}

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? files(dir + f + '/') : f.endsWith('.json') ? [dir + f] : []))
const named = new Set(read(R + 'content/srd/situations.json').entities.map((e) => e.id))
for (const file of [...files(R + 'content/srd/'), R + 'test-references/danalieth/catalog.json']) {
  for (const id of readFileSync(file, 'utf8').match(/situation\.[a-z0-9_]+/g) ?? []) {
    if (!named.has(id)) problems.push(`${file.replace(R, '')}: ${id} has no entry`)
  }
}

console.log(problems.length ? problems.join('\n') : 'OK')
process.exit(problems.length ? 1 : 0)

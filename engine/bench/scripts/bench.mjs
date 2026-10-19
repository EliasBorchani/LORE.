// Danalieth in V8 (the engine of Chrome and Node), through the same exported API as the React demo.
import { readFileSync } from 'node:fs'
import { SheetEngine } from 'dnd-engine'

const read = (file) => readFileSync(new URL(`../../../test-references/danalieth/${file}`, import.meta.url), 'utf8')
const catalog = read('catalog.json')
const character = read('character.json')

const time = (work) => {
  const start = performance.now()
  const result = work()
  return [result, performance.now() - start]
}
const best = (runs, work) => Math.min(...Array.from({ length: runs }, () => time(work)[1]))

const [engine, coldEngine] = time(() => new SheetEngine(catalog))
const [sheet, coldOpen] = time(() => engine.open(character, 59))
console.log(`first run: catalog ${coldEngine.toFixed(1)} ms, sheet ${coldOpen.toFixed(1)} ms`)
for (let i = 0; i < 20; i++) engine.open(character, 59)
console.log(`warm full recompute: best ${best(50, () => engine.open(character, 59)).toFixed(2)} ms (target < 100 ms)`)

const get = (key) => sheet.statistic(key)?.text
console.log(`check: Str ${get('ability.str.score')}, attack ${get('attack.melee')}, damage ${get('damage.melee')}`)
const [off, offMs] = time(() => sheet.setToggle('toggle.bulls_strength', false).asJsReadonlyArrayView())
console.log(`Bull's Strength off: ${offMs.toFixed(2)} ms, ${off.length} values changed, Str ${get('ability.str.score')}`)
const [on, onMs] = time(() => sheet.setToggle('toggle.bulls_strength', true).asJsReadonlyArrayView())
console.log(`Bull's Strength on:  ${onMs.toFixed(2)} ms, ${on.length} values changed, Str ${get('ability.str.score')}`)

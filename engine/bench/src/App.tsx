import { useMemo, useState } from 'react'
import { CharacterSheet, SheetEngine } from 'dnd-engine'
import catalogJson from '../../../test-references/danalieth/catalog.json?raw'
import characterJson from '../../../test-references/danalieth/character.json?raw'

const MAX_LEVEL = 59

function timed<T>(work: () => T): [T, number] {
  const start = performance.now()
  const result = work()
  return [result, performance.now() - start]
}

export function App() {
  const [engine, engineMs] = useMemo(() => timed(() => new SheetEngine(catalogJson)), [])
  const [level, setLevel] = useState(MAX_LEVEL)
  const [[sheet, openMs], setOpened] = useState<[CharacterSheet, number]>(() =>
    timed(() => engine.open(characterJson, MAX_LEVEL)),
  )
  // The sheet is a live object updated in place; this counter tells React to read it again.
  const [, setRevision] = useState(0)
  const [changed, setChanged] = useState<ReadonlyArray<string>>([])
  const [toggleMs, setToggleMs] = useState<number | null>(null)
  const [selected, setSelected] = useState('ability.str.score')
  const [filter, setFilter] = useState('')

  const openAt = (next: number) => {
    setLevel(next)
    setOpened(timed(() => engine.open(characterJson, next)))
    setChanged([])
    setToggleMs(null)
  }

  const toggle = (id: string, active: boolean) => {
    const [keys, ms] = timed(() => sheet.setToggle(id, active).asJsReadonlyArrayView())
    setChanged(keys)
    setToggleMs(ms)
    setRevision((r) => r + 1)
  }

  const statistics = sheet.statistics.asJsReadonlyArrayView().filter((s) => s.key.includes(filter))
  const breakdown = sheet.explain(selected).asJsReadonlyArrayView()
  const issues = sheet.issues.asJsReadonlyArrayView()

  return (
    <main>
      <header>
        <h1>
          {sheet.name} <span className="muted">level {sheet.level}</span>
        </h1>
        <p className="muted">
          Catalog compiled in {engineMs.toFixed(1)} ms · sheet computed in {openMs.toFixed(1)} ms
          {toggleMs !== null && <> · last toggle {toggleMs.toFixed(2)} ms, {changed.length} values changed</>}
        </p>
        <label>
          Sheet at level{' '}
          <input
            type="range" min={1} max={MAX_LEVEL} value={level}
            onChange={(e) => openAt(Number(e.target.value))}
          />{' '}
          {level}
        </label>
      </header>

      <div className="columns">
        <section>
          <h2>Toggles</h2>
          {sheet.toggles.asJsReadonlyArrayView().map((t) => (
            <label key={t.id} className="toggle">
              <input type="checkbox" checked={t.active} onChange={(e) => toggle(t.id, e.target.checked)} />
              {t.id.replace('toggle.', '')}
            </label>
          ))}
        </section>

        <section>
          <h2>Statistics</h2>
          <input placeholder="Filter, e.g. save" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <table>
            <tbody>
              {statistics.map((s) => (
                <tr
                  key={s.key}
                  className={[changed.includes(s.key) ? 'changed' : '', s.key === selected ? 'selected' : ''].join(' ')}
                  onClick={() => setSelected(s.key)}
                >
                  <td>{s.key}</td>
                  <td className="value">{s.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>
            {selected} = {sheet.statistic(selected)?.text ?? 'no value'}
          </h2>
          <table>
            <thead>
              <tr><th>Step</th><th>Source</th><th>Value</th><th>Type</th><th>Status</th></tr>
            </thead>
            <tbody>
              {breakdown.map((row, i) => (
                <tr key={i} className={row.status === 'applied' ? '' : 'suppressed'}>
                  <td>{row.step}</td>
                  <td>{row.source}</td>
                  <td className="value">{row.value}</td>
                  <td>{row.bonusType ?? ''}</td>
                  <td>{row.status}{row.detail && <span className="muted"> ({row.detail})</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {issues.length > 0 && (
            <>
              <h2>Issues</h2>
              <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

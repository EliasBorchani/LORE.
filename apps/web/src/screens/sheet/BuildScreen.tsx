import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { EntitySummary, LevelRecord, SpellListEntry } from '../../api/types'
import { Loading, StatBlock } from '../../components/grimoire'
import { Picker } from '../../components/Picker'
import { allOfType } from '../../sheet/catalogLists'
import { localized } from '../../sheet/names'
import { formatNumber } from '../../format'
import { abilities, fr, labelNames } from '../../i18n/fr'
import { useSheet } from '../../sheet/SheetContext'
import { messageOf } from '../../useLoad'
import { skillDetails, sortedSkills } from './SkillsTab'

const RECENT_LEVELS = 6

/** House rule: XP for level n is n × (n − 1) / 2 × 1000. */
const xpForLevel = (n: number) => (n * (n - 1) * 1000) / 2

export function BuildScreen() {
  const { record } = useSheet()
  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <div className="page-head-title" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="muted">{fr.build.title}</span>
            <h1 className="type-display-l">{record.character.name}</h1>
          </div>
          <Link className="btn btn-primary btn-small" to={`/characters/${record.id}`}>{fr.build.done}</Link>
        </div>
      </header>
      <Experience />
      <Levels />
      <Skills />
      <Spells />
      <Items />
    </>
  )
}

function Experience() {
  const { record } = useSheet()
  const xp = record.character.xp ?? 0
  const level = record.character.levels?.length ?? 0
  const next = xpForLevel(level + 1)
  return (
    <StatBlock title={fr.build.xp} aside={<span className="muted">{formatNumber(String(xp))} / {formatNumber(String(next))} XP</span>}>
      <div className="hp-bar" aria-hidden="true">
        <div style={{ width: `${Math.min(100, Math.round((xp / next) * 100))}%` }} />
      </div>
    </StatBlock>
  )
}

function Levels() {
  const { record, sheet, name } = useSheet()
  const [all, setAll] = useState(false)
  const failed = new Set(
    sheet.prerequisites.asJsReadonlyArrayView().filter((p) => p.failed.asJsReadonlyArrayView().length > 0).map((p) => p.entity),
  )
  const levels = [...(record.character.levels ?? [])].reverse()
  const shown = all ? levels : levels.slice(0, RECENT_LEVELS)

  return (
    <StatBlock title={fr.build.levels} aside={<span className="muted">{fr.build.newestFirst}</span>}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Link className="btn btn-primary btn-small" to={`/characters/${record.id}/level-up`}>{fr.editor.addLevel}</Link>
        <RemoveLastLevel />
      </div>
      <div>
        {shown.map((level) => {
          const flagged = levelIds(level).some((id) => failed.has(id))
          return (
            <div key={level.level} className="list-row">
              <span style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <span className="type-stat-m" style={{ minWidth: '2.5ch' }}>{level.level}</span>
                <span className="list-row-text">
                  <span>{name(level.classId)} {level.classLevel}</span>
                  <span className={flagged ? 'warning' : 'list-row-sub'}>
                    {flagged ? `${fr.build.check} · ` : ''}
                    {choices(level, name) || fr.build.noChoice}
                  </span>
                </span>
              </span>
            </div>
          )
        })}
      </div>
      {!all && levels.length > RECENT_LEVELS && (
        <button className="btn btn-secondary btn-small" onClick={() => setAll(true)}>
          {fr.build.showOlder(levels.length - RECENT_LEVELS)}
        </button>
      )}
      <p className="muted">{fr.build.replayNote}</p>
    </StatBlock>
  )
}

/** Two taps: the first asks, the second removes (the viewer shows no confirm dialogs). */
function RemoveLastLevel() {
  const { record, saveCharacter, reload } = useSheet()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const levels = record.character.levels ?? []
  if (levels.length === 0) return null

  async function remove() {
    setBusy(true)
    try {
      const result = await saveCharacter({ ...record.character, levels: levels.slice(0, -1) })
      setMessage(result === 'saved' ? fr.build.saved : fr.build.conflict)
      reload()
    } catch (error) {
      setMessage(`${fr.build.saveFailed} ${messageOf(error)}`)
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  return asking ? (
    <span style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="warning">{fr.editor.removeLastConfirm(levels.length)}</span>
      <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void remove()}>{fr.editor.confirm}</button>
      <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => setAsking(false)}>{fr.editor.cancel}</button>
    </span>
  ) : (
    <>
      <button className="btn btn-secondary btn-small" onClick={() => setAsking(true)}>{fr.editor.removeLast}</button>
      {message && <span role="status" className="muted">{message}</span>}
    </>
  )
}

/** Spells known (or the spellbook) of each casting class: remove one, or add from the class list. */
function Spells() {
  const { record, sheet, name, saveCharacter, reload } = useSheet()
  const casters = sheet.spellcasting.asJsReadonlyArrayView()
  if (casters.length === 0) return null
  return (
    <>
      {casters.map((c) => (
        <ClassSpells key={c.classId} classId={c.classId} mode={c.mode} known={[...c.spells.asJsReadonlyArrayView()]}
          record={record} name={name} saveCharacter={saveCharacter} reload={reload} />
      ))}
    </>
  )
}

function ClassSpells(props: {
  classId: string
  mode: string
  known: string[]
  record: ReturnType<typeof useSheet>['record']
  name: (id: string) => string
  saveCharacter: ReturnType<typeof useSheet>['saveCharacter']
  reload: () => void
}) {
  const { classId, mode, known, record, name, saveCharacter, reload } = props
  const [list, setList] = useState<SpellListEntry[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save(next: string[]) {
    setBusy(true)
    setMessage(null)
    const spellcasting = { ...(record.character.spellcasting ?? {}), [classId]: { ...(record.character.spellcasting?.[classId] ?? { mode }), known: next } }
    try {
      const result = await saveCharacter({ ...record.character, spellcasting })
      setMessage(result === 'saved' ? fr.build.saved : fr.build.conflict)
      reload()
    } catch (error) {
      setMessage(`${fr.build.saveFailed} ${messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function open() {
    setAdding(true)
    if (!list) api.spellList(classId).then(setList, (error) => setMessage(messageOf(error)))
  }

  const spellName = (id: string) => localized(list?.find((s) => s.id === id)?.name) ?? name(id)
  return (
    <StatBlock title={fr.editor.spells(name(classId))}>
      {known.length === 0 && <p className="muted">{fr.editor.noKnownSpells}</p>}
      {known.map((id) => (
        <div key={id} className="chosen">
          <span>{spellName(id)}</span>
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} aria-label={fr.editor.remove(spellName(id))}
            onClick={() => void save(known.filter((s) => s !== id))}>×</button>
        </div>
      ))}
      {adding ? (
        list ? (
          <Picker label={fr.editor.addSpell}
            items={list.filter((s) => !known.includes(s.id)).map((s) => ({ id: s.id, name: localized(s.name) ?? s.id, sub: fr.editor.spellSub(s.level) }))}
            onPick={(id) => void save([...known, id])} />
        ) : (
          <Loading />
        )
      ) : (
        <button className="btn btn-secondary btn-small" onClick={open}>{fr.editor.addSpell}</button>
      )}
      {message && <p role="status" className="muted">{message}</p>}
    </StatBlock>
  )
}

function levelIds(level: LevelRecord): string[] {
  return [level.classId, ...(level.feats ?? []).map((f) => f.id), ...(level.gained ?? [])]
}

function choices(level: LevelRecord, name: (id: string) => string): string {
  const ability = abilities.find((a) => a.id === level.abilityIncrease)
  return [
    ...(level.feats ?? []).map((f) => name(f.id)),
    ability ? fr.build.abilityIncrease(ability.name) : null,
    ...(level.gained ?? []).map(name),
    ...(level.spellcastingAdvances ?? []).map((c) => `${fr.sheet.casterLevel(name(c))} +1`),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Ranks for the whole character, grown where the player wants (owner's rule: no per-level spending). A draft is edited
 * here and saved in one go; a rank outside class skills costs 2 points.
 */
function Skills() {
  const { record, sheet, name, saveCharacter } = useSheet()
  const saved = record.character.skillRanks ?? {}
  const [draft, setDraft] = useState<Record<string, number>>(saved)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const skills = sortedSkills(sheet.skills.asJsReadonlyArrayView(), name)
  const total = sheet.skillPoints.total
  const cost = (id: string) => (skills.find((s) => s.id === id)?.classSkill ? 1 : 2)
  const spent = Object.entries(draft).reduce((sum, [id, ranks]) => sum + ranks * cost(id), 0)
  const left = total == null ? Infinity : Number(total) - spent
  const changed = JSON.stringify(clean(draft)) !== JSON.stringify(clean(saved))

  const step = (id: string, delta: number) => {
    setMessage(null)
    setDraft((d) => ({ ...d, [id]: Math.max(0, (d[id] ?? 0) + delta) }))
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await saveCharacter({ ...record.character, skillRanks: clean(draft) })
      setMessage(result === 'saved' ? fr.build.saved : fr.build.conflict)
    } catch (error) {
      setMessage(`${fr.build.saveFailed} ${messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StatBlock title={fr.build.skills} aside={<span className={left < 0 ? 'warning' : 'muted'}>{fr.build.skillPoints(spent, total ?? '—')}</span>}>
      <p className="muted">{fr.build.skillCost}</p>
      <div>
        {skills.map((s) => {
          const ranks = draft[s.id] ?? 0
          const max = s.maxRanks == null ? Infinity : Number(s.maxRanks)
          const label = name(s.id)
          return (
            <div key={s.id} className="list-row">
              <span className="list-row-text">
                <span>{label}</span>
                <span className={ranks > max ? 'warning' : 'list-row-sub'}>{skillDetails({
                  ability: s.ability, ranks: String(ranks), maxRanks: s.maxRanks, classSkill: s.classSkill,
                  trainedOnly: s.trainedOnly, armorCheckPenalty: s.armorCheckPenalty,
                })}</span>
              </span>
              <span className="stepper">
                <button type="button" aria-label={fr.build.skillLess(label)} disabled={busy || ranks <= 0} onClick={() => step(s.id, -1)}>−</button>
                <output aria-live="polite">{ranks}</output>
                <button type="button" aria-label={fr.build.skillMore(label)} disabled={busy || ranks >= max || left < cost(s.id)}
                  onClick={() => step(s.id, 1)}>+</button>
              </span>
            </div>
          )
        })}
      </div>
      {left < 0 && <p className="warning">{fr.build.overBudget}</p>}
      <button className="btn btn-primary" disabled={busy || !changed} onClick={save}>
        {busy ? fr.build.saving : fr.build.saveSkills}
      </button>
      {message && <p role="status" className="muted">{message}</p>}
    </StatBlock>
  )
}

/** Ranks without the zeros, so an untouched skill and one put back to 0 compare equal. */
function clean(ranks: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(ranks).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)))
}

function Items() {
  const { record, name, saveCharacter, reload } = useSheet()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<EntitySummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const items = record.character.items ?? []

  /** Adding or removing changes which entities the sheet needs, so the catalog is loaded again. */
  async function saveItems(next: { id: string; equipped?: boolean }[]) {
    setBusy(true)
    setMessage(null)
    try {
      setMessage((await saveCharacter({ ...record.character, items: next })) === 'saved' ? fr.build.saved : fr.build.conflict)
      reload()
    } catch (error) {
      setMessage(`${fr.build.saveFailed} ${messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function open() {
    setAdding(true)
    if (!catalog) allOfType('item').then(setCatalog, (error) => setMessage(messageOf(error)))
  }
  const itemName = (id: string) => localized(catalog?.find((i) => i.id === id)?.name) ?? name(id)

  async function setEquipped(index: number, equipped: boolean) {
    setBusy(true)
    setMessage(null)
    const next = { ...record.character, items: items.map((item, i) => (i === index ? { ...item, equipped } : item)) }
    try {
      setMessage((await saveCharacter(next)) === 'saved' ? fr.build.saved : fr.build.conflict)
    } catch (error) {
      setMessage(`${fr.build.saveFailed} ${messageOf(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StatBlock title={fr.build.items}>
      <div className="toggles">
        {items.map((item, i) => (
          <label key={`${item.id}-${i}`} className={`toggle-row${item.equipped !== false ? ' on' : ''}`}>
            <span className="toggle-text">
              <span className="toggle-name">{name(item.id)}</span>
            </span>
            <input type="checkbox" checked={item.equipped !== false} disabled={busy}
              aria-label={fr.build.equipped(name(item.id))} onChange={(e) => setEquipped(i, e.target.checked)} />
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} aria-label={fr.editor.remove(itemName(item.id))}
              onClick={(e) => { e.preventDefault(); void saveItems(items.filter((_, j) => j !== i)) }}>×</button>
          </label>
        ))}
        {items.length === 0 && <p className="muted">{fr.build.noItems}</p>}
      </div>
      {adding ? (
        catalog ? (
          <Picker label={fr.build.addItem}
            items={catalog.map((i) => ({ id: i.id, name: localized(i.name) ?? i.id, sub: (i.labels ?? []).filter((l) => l !== 'item').map((l) => labelNames[l] ?? l).join(' · ') }))
              .sort((a, b) => a.name.localeCompare(b.name, 'fr'))}
            onPick={(id) => void saveItems([...items, { id, equipped: true }])} />
        ) : (
          <Loading />
        )
      ) : (
        <button className="btn btn-secondary btn-small" onClick={open}>{fr.build.addItem}</button>
      )}
      {message && <p role="status" className="muted">{message}</p>}
    </StatBlock>
  )
}

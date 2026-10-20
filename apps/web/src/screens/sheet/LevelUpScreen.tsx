import { SheetEngine, type CharacterSheet } from 'dnd-engine'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Character, Closure, EntitySummary, LevelRecord } from '../../api/types'
import { ErrorNotice, StatBlock } from '../../components/grimoire'
import { EntityName, InfoButton } from '../../components/EntityPanel'
import { Picker } from '../../components/Picker'
import { formatModifier, formatNumber } from '../../format'
import { abilities, fr, labelNames, statLabels } from '../../i18n/fr'
import { allOfType } from '../../sheet/catalogLists'
import { entityName, localized } from '../../sheet/names'
import { useSheet } from '../../sheet/SheetContext'
import { messageOf } from '../../useLoad'
import { useGroupApi, useGroupPath } from '../../group/GroupContext'

interface FeatPick {
  id: string
  slot: string
}

const PREVIEW = ['hp.max', 'bab', 'save.fort', 'save.ref', 'save.will', 'skill_points.total']

/**
 * Adds one level at the end (owner's choice for the first version): class, ability increase every 4 levels, a feat
 * for each free slot, the class a feat's choice applies to, and the casting classes a prestige level advances. The
 * draft is computed live from the catalog it needs; rule breaks are flagged, never refused.
 */
export function LevelUpScreen() {
  const groupApi = useGroupApi()
  const groupPath = useGroupPath()
  const { record, name: currentName, stat, saveCharacter, reload } = useSheet()
  const navigate = useNavigate()
  const levels = record.character.levels ?? []
  const level = levels.length + 1

  const [classes, setClasses] = useState<EntitySummary[]>([])
  const [feats, setFeats] = useState<EntitySummary[]>([])
  const [classId, setClassId] = useState(levels.at(-1)?.classId ?? '')
  const [abilityIncrease, setAbilityIncrease] = useState('')
  const [picked, setPicked] = useState<FeatPick[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [advances, setAdvances] = useState<string[]>([])
  const [closure, setClosure] = useState<Closure | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([allOfType(groupApi, 'class'), allOfType(groupApi, 'prestige_class')]).then(([base, prestige]) => setClasses([...base, ...prestige]), (e) => setError(messageOf(e)))
    allOfType(groupApi, 'feat').then(setFeats, (e) => setError(messageOf(e)))
  }, [])

  const classType = new Map(classes.map((c) => [c.id, c.type]))
  const summaryName = (id: string) => {
    const summary = classes.find((c) => c.id === id) ?? feats.find((f) => f.id === id)
    return summary ? (localized(summary.name) ?? id) : currentName(id)
  }

  const draft: Character | null = useMemo(() => {
    if (!classId) return null
    const classLevel = levels.filter((l) => l.classId === classId).length + 1
    const next: LevelRecord = {
      level,
      classId,
      classLevel,
      ...(picked.length ? { feats: picked.map((f) => ({ id: f.id, slot: f.slot })) } : {}),
      ...(abilityIncrease && level % 4 === 0 ? { abilityIncrease } : {}),
      ...(advances.length ? { spellcastingAdvances: advances } : {}),
    }
    return { ...record.character, levels: [...levels, next], choices: { ...(record.character.choices ?? {}), ...choices } }
  }, [record, levels, level, classId, picked, abilityIncrease, advances, choices])

  // The catalog the draft needs: fetched again when a new id enters the draft (a class, a feat).
  const draftKey = draft ? JSON.stringify([classId, picked.map((p) => p.id)]) : ''
  useEffect(() => {
    if (!draft) return
    let current = true
    setClosure(null)
    groupApi.draftCatalog(draft).then((c) => current && setClosure(c), (e) => current && setError(messageOf(e)))
    return () => {
      current = false
    }
    // Only new ids change the catalog; other draft changes reuse it.
  }, [draftKey])

  const engine = useMemo(() => (closure ? new SheetEngine(JSON.stringify(closure.catalog)) : null), [closure])
  const preview: CharacterSheet | null = useMemo(() => (engine && draft ? engine.open(JSON.stringify(draft), 0) : null), [engine, draft])
  const entityOf = (id: string) => closure?.catalog.entities.find((e) => e.id === id)
  const name = (id: string) => (entityOf(id) ? entityName(entityOf(id), id) : summaryName(id))

  const freeSlots = preview
    ? preview.featSlots.asJsReadonlyArrayView().filter((s) => Number(s.available) > s.used).map((s) => ({ slot: s.slot, left: Number(s.available) - s.used }))
    : []
  const failures = preview
    ? preview.prerequisites.asJsReadonlyArrayView().filter((p) => p.entity === classId || picked.some((f) => f.id === p.entity))
    : []
  const needsChoice = picked.filter((f) => JSON.stringify(entityOf(f.id)?.effects ?? []).includes('{choice}'))
  const ownClasses = [...new Set((draft?.levels ?? []).map((l) => l.classId))]
  const casters = preview ? preview.spellcasting.asJsReadonlyArrayView().map((c) => c.classId).filter((c) => c !== classId) : []

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const result = await saveCharacter(draft)
      if (result === 'conflict') {
        setError(fr.build.conflict)
        setBusy(false)
        return
      }
      reload()
      navigate(groupPath(`/characters/${record.id}/build`))
    } catch (e) {
      setError(`${fr.build.saveFailed} ${messageOf(e)}`)
      setBusy(false)
    }
  }

  const classOptions = (type: string) =>
    classes
      .filter((c) => c.type === type)
      .map((c) => ({ id: c.id, name: localized(c.name) ?? c.id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)

  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <div className="page-head-title" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className="muted">{record.character.name}</span>
            <h1 className="type-display-l">{fr.editor.levelTitle(level)}</h1>
          </div>
          <Link className="btn btn-secondary btn-small" to={groupPath(`/characters/${record.id}/build`)}>{fr.editor.cancel}</Link>
        </div>
      </header>
      {error && <ErrorNotice message={error} />}

      <StatBlock title={fr.editor.classTaken}>
        <label className="field">
          <span>{fr.editor.classTaken}</span>
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setAdvances([]) }}>
            <option value="">{fr.editor.pick}</option>
            <optgroup label={fr.editor.baseClasses}>{classOptions('class')}</optgroup>
            <optgroup label={fr.editor.prestigeClasses}>{classOptions('prestige_class')}</optgroup>
          </select>
        </label>
        {classId && draft && (
          <p className="muted chosen">
            {fr.editor.classLevel(name(classId), draft.levels!.at(-1)!.classLevel)}
            <InfoButton id={classId} name={name(classId)} />
          </p>
        )}
        {level % 4 === 0 && (
          <label className="field">
            <span>{fr.editor.abilityIncrease}</span>
            <select className="input" value={abilityIncrease} onChange={(e) => setAbilityIncrease(e.target.value)}>
              <option value="">{fr.editor.pick}</option>
              {abilities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {classType.get(classId) === 'prestige_class' && casters.length > 0 && (
          <fieldset className="field">
            <span>{fr.editor.advances}</span>
            {casters.map((c) => (
              <label key={c} className="toggle-row">
                <span className="toggle-name">{name(c)}</span>
                <input type="checkbox" checked={advances.includes(c)}
                  onChange={(e) => setAdvances((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} />
                <InfoButton id={c} name={name(c)} />
              </label>
            ))}
          </fieldset>
        )}
      </StatBlock>

      {draft && (
        <StatBlock title={fr.editor.feats}>
          {picked.map((f) => (
            <div key={`${f.slot}-${f.id}`} className="chosen">
              <span className="list-row-text">
                <EntityName id={f.id}>{name(f.id)}</EntityName>
                <span className="list-row-sub">{slotName(f.slot, name)}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-small" aria-label={fr.editor.remove(name(f.id))}
                onClick={() => setPicked((p) => p.filter((x) => x !== f))}>×</button>
            </div>
          ))}
          {needsChoice.map((f) => (
            <label key={`choice-${f.id}`} className="field">
              <span>{fr.editor.choiceFor(name(f.id))}</span>
              <select className="input" value={choices[f.id] ?? record.character.choices?.[f.id] ?? ''}
                onChange={(e) => setChoices((c) => ({ ...c, [f.id]: e.target.value }))}>
                <option value="">{fr.editor.pick}</option>
                {ownClasses.map((c) => <option key={c} value={c}>{name(c)}</option>)}
              </select>
            </label>
          ))}
          {!preview && <p className="muted">{fr.editor.loadingPreview}</p>}
          {preview && freeSlots.length === 0 && picked.length === 0 && <p className="muted">{fr.editor.noFreeSlot}</p>}
          {freeSlots.map((s) => (
            <div key={s.slot}>
              <p>{fr.editor.freeSlot(slotName(s.slot, name), s.left)}</p>
              <Picker items={featsFor(s.slot, feats, picked)} onPick={(id) => setPicked((p) => [...p, { id, slot: s.slot }])} />
            </div>
          ))}
        </StatBlock>
      )}

      {preview && (
        <StatBlock title={fr.editor.preview}>
          <dl className="facts">
            {PREVIEW.map((key) => {
              const after = preview.statistic(key)?.text
              if (after == null) return null
              const before = stat(key)
              const show = (v: string) => (key.startsWith('save.') ? formatModifier(v) : formatNumber(v))
              return (
                <div key={key} style={{ display: 'contents' }}>
                  <dt>{statLabels[key] ?? key}</dt>
                  <dd>{before != null && before !== after ? `${show(before)} → ` : ''}{show(after)}</dd>
                </div>
              )
            })}
          </dl>
          {failures.map((f) => (
            <div key={f.entity} className="warning">
              <strong>{name(f.entity)}</strong>
              {f.failed.asJsReadonlyArrayView().length > 0 && <p>{fr.editor.prerequisiteFailed(f.failed.asJsReadonlyArrayView().join(' ; '))}</p>}
              {f.unknown.asJsReadonlyArrayView().length > 0 && <p className="muted">{fr.editor.cannotCheck(f.unknown.asJsReadonlyArrayView().join(' ; '))}</p>}
            </div>
          ))}
          <p className="muted">{fr.editor.flagged}</p>
        </StatBlock>
      )}

      <button className="btn btn-primary" disabled={busy || !draft} onClick={() => void save()}>
        {busy ? fr.editor.saving : fr.editor.save}
      </button>
    </>
  )
}

/** « général », « épique », « bonus (Guerrier) » for `fighter_bonus`… */
function slotName(slot: string, name: (id: string) => string): string {
  const known = fr.editor.slotNames[slot]
  if (known) return known
  const bonus = /^(.+)_bonus$/.exec(slot)
  return bonus ? `bonus (${name(`class.${bonus[1]}`)})` : slot
}

/**
 * The feats a slot offers: a class bonus slot lists the feats labelled for it (`fighter_bonus`) when there are any,
 * the epic bonus slot the epic feats, other slots every feat. Feats already picked are left out.
 */
function featsFor(slot: string, feats: EntitySummary[], picked: FeatPick[]) {
  const label = slot === 'epic_bonus' ? 'epic' : slot
  const labelled = feats.filter((f) => f.labels?.includes(label))
  const pool = slot !== 'general' && slot !== 'epic' && labelled.length > 0 ? labelled : feats
  return pool
    .filter((f) => !picked.some((p) => p.id === f.id))
    .map((f) => ({ id: f.id, name: localized(f.name) ?? f.id, sub: (f.labels ?? []).filter((l) => l !== 'feat').map((l) => labelNames[l] ?? l).join(' · ') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

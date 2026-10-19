import { ContentCheck } from 'dnd-engine'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, ApiError } from '../api/client'
import type { CoreSections, EntityDetail, EntitySummary, SpellLevel } from '../api/types'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { emptyEffect, fromDraft, idFrom, toDraft, type EffectDraft, type EntityDraft } from '../content/entityForm'
import { entityTypes, fr, typeName } from '../i18n/fr'
import { allOfType, forgetLists } from '../sheet/catalogLists'
import { entityName, localized } from '../sheet/names'
import { messageOf } from '../useLoad'

const OPS = ['add', 'multiply', 'set', 'min', 'max', 'dice', 'grant']
const CHECK_DELAY_MS = 300

/** One line of a spell's levels; the level stays text while it is typed. */
interface ListDraft {
  to: string
  level: string
}

const LIST_TYPES = ['class', 'prestige_class', 'domain']
const MAX_SPELL_LEVEL = 30

interface Start {
  core: CoreSections
  draft: EntityDraft
  lists: ListDraft[]
  /** The version being edited; absent for a new entity. */
  version?: number
  variantOf?: string
  title: string
}

/**
 * Creates or edits a catalog entity (PRD 5: the structured editor). The common fields are a form; the blocks of
 * each category stay JSON. The engine checks the entity as it is typed, and a save needs no problem left. Every save
 * is a new version with its author and note.
 */
function listsOf(detail: EntityDetail | null): ListDraft[] {
  return (detail?.relations ?? [])
    .filter((r) => r.relation === 'on_spell_list')
    .map((r) => ({ to: r.to, level: r.extra.level == null ? '' : String(r.extra.level) }))
}

export function EntityEditorScreen() {
  const id = useParams().id
  const [params] = useSearchParams()
  const from = params.get('from') ?? undefined
  const newType = params.get('type') ?? 'feat'
  const [start, setStart] = useState<Start | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const editing = id ?? from
    Promise.all([api.core(), editing ? api.entity(editing) : Promise.resolve(null)]).then(
      ([core, detail]) => current && setStart(startOf(core, detail, id != null, newType)),
      (e) => current && setError(messageOf(e)),
    )
    return () => {
      current = false
    }
  }, [id, from, newType])

  if (error) return <ErrorNotice message={error} />
  if (!start) return <Loading />
  return <Editor key={`${start.draft.id}-${start.version}`} start={start} onReplaced={(detail) => setStart({ ...start, draft: toDraft(detail.content), lists: listsOf(detail), version: detail.version })} />
}

function startOf(core: CoreSections, detail: EntityDetail | null, editing: boolean, newType: string): Start {
  if (detail && editing) {
    return { core, draft: toDraft(detail.content), lists: listsOf(detail), version: detail.version, title: fr.content.editTitle(entityName(detail.content, detail.id)) }
  }
  if (detail) {
    // A team copy: same content, its own id, team provenance (official content stays as it is).
    const draft = toDraft({ ...detail.content, id: `${detail.id}_team`, provenance: 'team' })
    return { core, draft, lists: listsOf(detail), variantOf: detail.id, title: fr.content.variantTitle(entityName(detail.content, detail.id)) }
  }
  const draft = toDraft({ id: '', type: newType, name: {}, provenance: 'team' })
  return { core, draft, lists: [], title: fr.content.newTitle }
}

function Editor({ start, onReplaced }: { start: Start; onReplaced: (detail: EntityDetail) => void }) {
  const navigate = useNavigate()
  const creating = start.version == null
  const [draft, setDraft] = useState(start.draft)
  const [idTouched, setIdTouched] = useState(!creating || start.variantOf != null)
  const [note, setNote] = useState('')
  const [lists, setLists] = useState(start.lists)
  const [listOptions, setListOptions] = useState<EntitySummary[]>([])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<EntityDetail | null>(null)

  const set = (patch: Partial<EntityDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      // A new id follows the name until it is typed by hand; English first, ids are English.
      if (!idTouched && ('nameEn' in patch || 'nameFr' in patch || 'type' in patch)) next.id = idFrom(next.type, next.nameEn || next.nameFr)
      return next
    })
  const setEffect = (index: number, patch: Partial<EffectDraft>) =>
    setDraft((d) => ({ ...d, effects: d.effects.map((e, i) => (i === index ? { ...e, ...patch } : e)) }))

  const isSpell = draft.type === 'spell'
  useEffect(() => {
    if (!isSpell) return
    Promise.all(LIST_TYPES.map(allOfType)).then((all) => setListOptions(all.flat()), () => setListOptions([]))
  }, [isSpell])
  const listName = (id: string) => {
    const option = listOptions.find((o) => o.id === id)
    return option ? (localized(option.name) ?? id) : id
  }

  const built = useMemo(() => fromDraft(draft), [draft])
  const issues = useCheck(built, start.core)
  const listProblems = isSpell ? checkLists(lists, listName) : []
  const blocked = !('entity' in built) || issues == null || issues.length > 0 || listProblems.length > 0

  const targets = useMemo(
    () => [...(start.core.statistics ?? []).map((s) => s.key), ...(start.core.targetGroups ?? []).map((g) => g.key)].sort(),
    [start.core],
  )
  const bonusTypes = (start.core.bonusTypes ?? []).map((b) => b.id).sort()

  async function save() {
    if (!('entity' in built) || blocked) return
    setBusy(true)
    setSaveError(null)
    try {
      const spellLists: SpellLevel[] | undefined = isSpell ? lists.map((l) => ({ to: l.to, level: Number(l.level) })) : undefined
      const saved = creating
        ? await api.createEntity(built.entity, note, start.variantOf, spellLists)
        : await api.updateEntity(built.entity, start.version!, note, spellLists)
      forgetLists()
      navigate(`/catalog/entity/${saved.id}`)
    } catch (e) {
      setBusy(false)
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.body as { current: EntityDetail }).current
        if (creating) setSaveError(fr.content.idTaken(current.id))
        else setConflict(current)
      } else if (e instanceof ApiError && e.status === 403) {
        setSaveError(fr.content.forbidden)
      } else {
        setSaveError(`${fr.content.saveFailed} ${messageOf(e)}`)
      }
    }
  }

  const back = creating ? (start.variantOf ? `/catalog/entity/${start.variantOf}` : `/catalog/${draft.type}`) : `/catalog/entity/${draft.id}`

  return (
    <>
      <header className="page-head">
        <div className="page-head-row">
          <h1 className="type-display-l">{start.title}</h1>
          <Link className="btn btn-secondary btn-small" to={back}>{fr.content.cancel}</Link>
        </div>
      </header>

      <StatBlock title={typeName(draft.type)}>
        {creating && !start.variantOf && (
          <label className="field">
            <span>{fr.content.type}</span>
            <select className="input" value={draft.type} onChange={(e) => set({ type: e.target.value })}>
              {entityTypes.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
            </select>
          </label>
        )}
        <TextField label={fr.content.nameFr} value={draft.nameFr} onChange={(nameFr) => set({ nameFr })} />
        <TextField label={fr.content.nameEn} value={draft.nameEn} onChange={(nameEn) => set({ nameEn })} />
        {creating ? (
          <label className="field">
            <span>{fr.content.id}</span>
            <input className="input" value={draft.id} autoComplete="off" spellCheck={false}
              onChange={(e) => { setIdTouched(true); set({ id: e.target.value }) }} />
            <span className="field-hint">{fr.content.idHint}</span>
          </label>
        ) : (
          <p className="muted">{fr.content.id} : <code>{draft.id}</code></p>
        )}
        <TextField label={fr.content.descriptionFr} value={draft.descriptionFr} onChange={(descriptionFr) => set({ descriptionFr })} long />
        <TextField label={fr.content.descriptionEn} value={draft.descriptionEn} onChange={(descriptionEn) => set({ descriptionEn })} long />
        <TextField label={fr.content.labels} hint={fr.content.labelsHint} value={draft.labels} onChange={(labels) => set({ labels })} />
        <TextField label={fr.content.prerequisite} value={draft.prerequisite} onChange={(prerequisite) => set({ prerequisite })} code />
        <TextField label={fr.content.usesPerDay} value={draft.usesPerDay} onChange={(usesPerDay) => set({ usesPerDay })} code />
      </StatBlock>

      {isSpell && (
        <StatBlock title={fr.content.spellLevels}>
          <p className="field-hint">{fr.content.spellLevelsHint}</p>
          {lists.map((line, i) => (
            <div key={i} className="list-line">
              <label className="field">
                <span>{fr.content.list}</span>
                <select className="input" value={line.to} onChange={(e) => setLists((ls) => ls.map((l, j) => (j === i ? { ...l, to: e.target.value } : l)))}>
                  <option value="">{fr.editor.pick}</option>
                  {line.to && !listOptions.some((o) => o.id === line.to) && <option value={line.to}>{line.to}</option>}
                  <ListOptions options={listOptions} type="class" label={fr.editor.baseClasses} />
                  <ListOptions options={listOptions} type="prestige_class" label={fr.editor.prestigeClasses} />
                  <ListOptions options={listOptions} type="domain" label={fr.content.domains} />
                </select>
              </label>
              <label className="field list-level">
                <span>{fr.content.level}</span>
                <input className="input" type="number" inputMode="numeric" min="0" max={MAX_SPELL_LEVEL} value={line.level}
                  onChange={(e) => setLists((ls) => ls.map((l, j) => (j === i ? { ...l, level: e.target.value } : l)))} />
              </label>
              <button type="button" className="btn btn-secondary btn-small" aria-label={fr.content.removeList(listName(line.to))}
                onClick={() => setLists((ls) => ls.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setLists((ls) => [...ls, { to: '', level: '' }])}>
            {fr.content.addList}
          </button>
        </StatBlock>
      )}

      <StatBlock title={fr.content.effects}>
        <datalist id="effect-targets">{targets.map((t) => <option key={t} value={t} />)}</datalist>
        {draft.effects.map((effect, i) => (
          <EffectCard key={i} index={i} effect={effect} bonusTypes={bonusTypes} onChange={(patch) => setEffect(i, patch)}
            onRemove={() => setDraft((d) => ({ ...d, effects: d.effects.filter((_, j) => j !== i) }))}
            onMoveUp={i > 0 ? () => setDraft((d) => ({ ...d, effects: swap(d.effects, i - 1, i) })) : undefined} />
        ))}
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft((d) => ({ ...d, effects: [...d.effects, emptyEffect()] }))}>
          {fr.content.addEffect}
        </button>
      </StatBlock>

      <StatBlock title={fr.content.other}>
        <TextField label="JSON" hint={fr.content.otherHint} value={draft.other} onChange={(other) => set({ other })} long code />
      </StatBlock>

      <StatBlock title={fr.content.checks}>
        {'error' in built && <p className="warning">{fr.content.otherInvalid(built.error)}</p>}
        {listProblems.map((problem) => <p key={problem} className="warning">{problem}</p>)}
        {'entity' in built && issues == null && <p className="muted">{fr.content.checking}</p>}
        {issues?.length === 0 && <p className="muted">{fr.content.allGood}</p>}
        {issues && issues.length > 0 && (
          <ul>
            {issues.map((issue, i) => (
              <li key={i} className="warning">
                {fr.content.issueAt(issue.at)}<strong>{fr.content.issues[issue.code] ?? issue.code}</strong> ({issue.message})
              </li>
            ))}
          </ul>
        )}
      </StatBlock>

      <TextField label={fr.content.note} value={note} onChange={setNote} placeholder={fr.content.notePlaceholder} />
      {saveError && <ErrorNotice message={saveError} />}
      {conflict && (
        <div className="notice warning" role="alert">
          <p>{fr.content.conflict(conflict.version)}</p>
          <button className="btn btn-secondary btn-small" onClick={() => onReplaced(conflict)}>{fr.content.takeCurrent}</button>
        </div>
      )}
      {blocked && <p className="muted">{fr.content.fixFirst}</p>}
      <button className="btn btn-primary" disabled={busy || blocked} onClick={() => void save()}>
        {busy ? fr.content.saving : fr.content.save}
      </button>
    </>
  )
}

function ListOptions({ options, type, label }: { options: EntitySummary[]; type: string; label: string }) {
  const sorted = options
    .filter((o) => o.type === type)
    .map((o) => ({ id: o.id, name: localized(o.name) ?? o.id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return <optgroup label={label}>{sorted.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>
}

/** What the server would refuse, said before saving. */
function checkLists(lists: ListDraft[], name: (id: string) => string): string[] {
  const problems: string[] = []
  if (lists.some((l) => !l.to)) problems.push(fr.content.listMissing)
  const seen = new Set<string>()
  for (const line of lists.filter((l) => l.to)) {
    if (seen.has(line.to)) problems.push(fr.content.listTwice(name(line.to)))
    seen.add(line.to)
    const level = Number(line.level)
    if (line.level.trim() === '' || !Number.isInteger(level) || level < 0 || level > MAX_SPELL_LEVEL) {
      problems.push(fr.content.levelInvalid(name(line.to)))
    }
  }
  return problems
}

/** The engine's check, run once typing pauses. Null while waiting. */
function useCheck(built: ReturnType<typeof fromDraft>, core: CoreSections) {
  const coreJson = useMemo(() => JSON.stringify(core), [core])
  const entityJson = 'entity' in built ? JSON.stringify(built.entity) : null
  const [result, setResult] = useState<{ json: string; issues: { code: string; at: string; message: string }[] } | null>(null)
  useEffect(() => {
    if (entityJson == null) return
    const timer = setTimeout(() => {
      const issues = ContentCheck.getInstance().entity(entityJson, coreJson).asJsReadonlyArrayView()
      setResult({ json: entityJson, issues: issues.map((i) => ({ code: i.code, at: i.at, message: i.message })) })
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [entityJson, coreJson])
  return result && result.json === entityJson ? result.issues : null
}

function EffectCard(props: {
  index: number
  effect: EffectDraft
  bonusTypes: string[]
  onChange: (patch: Partial<EffectDraft>) => void
  onRemove: () => void
  onMoveUp?: () => void
}) {
  const { effect, onChange } = props
  const n = props.index + 1
  return (
    <div className="effect-card">
      <div className="effect-head">
        <strong>{fr.content.effect(n)}</strong>
        <span className="button-row">
          {props.onMoveUp && (
            <button type="button" className="btn btn-secondary btn-small" aria-label={fr.content.moveUp(n)} onClick={props.onMoveUp}>↑</button>
          )}
          <button type="button" className="btn btn-secondary btn-small" aria-label={fr.content.removeEffect(n)} onClick={props.onRemove}>×</button>
        </span>
      </div>
      <label className="field">
        <span>{fr.content.target}</span>
        <input className="input" list="effect-targets" value={effect.target} autoComplete="off" spellCheck={false} onChange={(e) => onChange({ target: e.target.value })} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>{fr.content.op}</span>
          <select className="input" value={effect.op} onChange={(e) => onChange({ op: e.target.value })}>
            {OPS.map((op) => <option key={op} value={op}>{fr.content.ops[op]}</option>)}
          </select>
        </label>
        <TextField label={fr.content.value} value={effect.value} onChange={(value) => onChange({ value })} code />
        {(effect.op === 'add' || effect.bonusType) && (
          <label className="field">
            <span>{fr.content.bonusType}</span>
            <select className="input" value={effect.bonusType} onChange={(e) => onChange({ bonusType: e.target.value })}>
              <option value="">{fr.content.none}</option>
              {withCurrent(props.bonusTypes, effect.bonusType).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}
        {(effect.op === 'set' || effect.layer) && (
          <Select label={fr.content.layer} value={effect.layer} options={fr.content.layers} onChange={(layer) => onChange({ layer })} />
        )}
        <Select label={fr.content.scope} value={effect.scope} options={fr.content.scopes} onChange={(scope) => onChange({ scope })} />
      </div>
      {(effect.op === 'multiply' || effect.multMode) && (
        <TextField label={fr.content.multMode} hint="additive, multiplicative, exclusive: <groupe>" value={effect.multMode} onChange={(multMode) => onChange({ multMode })} code />
      )}
      <TextField label={fr.content.condition} value={effect.condition} onChange={(condition) => onChange({ condition })} code />
      <TextField label={fr.content.situation} value={effect.situation} onChange={(situation) => onChange({ situation })} code />
    </div>
  )
}

function TextField(props: { label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; long?: boolean; code?: boolean }) {
  const className = `input${props.code ? ' code' : ''}`
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.long ? (
        <textarea className={className} value={props.value} placeholder={props.placeholder} spellCheck={!props.code} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input className={className} value={props.value} placeholder={props.placeholder} autoComplete="off" spellCheck={!props.code} onChange={(e) => props.onChange(e.target.value)} />
      )}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{fr.content.none}</option>
        {withCurrent(Object.keys(options), value).map((key) => <option key={key} value={key}>{options[key] ?? key}</option>)}
      </select>
    </label>
  )
}

/** A value read from the content stays selectable even when the list does not know it (the check flags it). */
function withCurrent(options: string[], value: string) {
  return value && !options.includes(value) ? [...options, value] : options
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

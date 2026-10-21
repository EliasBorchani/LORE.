import { ContentCheck } from 'dnd-engine'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, ApiError, type GroupApi } from '../api/client'
import type { CoreSections, DraftPayload, Effect, Entity, EntityDetail, EntitySummary, GroupRuleset, Localized, SpellLevel, StateUse } from '../api/types'
import { CmsContext, type CmsData } from '../cms/context'
import { ENTRY_TYPES, type EntryType } from '../cms/entries'
import { Field } from '../cms/fields'
import { FormEngine } from '../cms/FormEngine'
import { LiveCard } from '../cms/LiveCard'
import { entityInfo, forgetEntityInfo } from '../components/EntityPanel'
import { ErrorNotice, Loading } from '../components/grimoire'
import { idFrom } from '../content/entityForm'
import { bonusTypes as bonusTypeNames, entityTypes, fr } from '../i18n/fr'
import { selfToggle } from '../rpg/dnd35/formulas'
import { formFor } from '../rpg/dnd35/forms'
import type { TargetOption } from '../rpg/dnd35/targets'
import { allOfType, forgetLists } from '../sheet/catalogLists'
import { entityName, localized } from '../sheet/names'
import { messageOf } from '../useLoad'
import { useGroup, useGroupApi, useGroupPath } from '../group/GroupContext'

const CHECK_DELAY_MS = 300
const AUTOSAVE_DELAY_MS = 2000
const NAMES_DELAY_MS = 500
const LIST_TYPES = ['class', 'prestige_class', 'domain']
const MAX_SPELL_LEVEL = 30
/** Where a new entity can go: a ruleset of the group the caller edits, or official content (platform admin). */
const OFFICIAL = ''
const ID_IN_TEXT = /(?:[a-z][a-z0-9_]*:)?[a-z][a-z0-9_]*\.[a-z0-9_]+/g

/** One line of a spell's levels; the level stays text while it is typed. */
interface ListDraft {
  to: string
  level: string
}

interface Target {
  /** A ruleset slug, or `OFFICIAL`. */
  slug: string
  name: string
}

interface Start {
  core: CoreSections
  states: StateUse[]
  skills: TargetOption[]
  classes: TargetOption[]
  entries: Record<EntryType, TargetOption[]>
  names: Map<string, string>
  payload: DraftPayload
  draftId?: string
  /** For a new entity: its possible places. */
  targets: Target[]
  title: string
  /** A copy keeps another entry's content: its id must change. */
  copiedFrom?: string
}

const options = (items: EntitySummary[]): TargetOption[] =>
  items.map((i) => ({ key: i.id, label: localized(i.name) ?? i.id })).sort((a, b) => a.label.localeCompare(b.label, 'fr'))

/**
 * Creates or edits a catalog entity with the type's guided form (docs/prd-cms.md). Saves a private draft at any
 * time; « Publier » needs every check of the engine green, and each publication is a new version with its note.
 */
export function EntityEditorScreen() {
  const groupApi = useGroupApi()
  const { group } = useGroup()
  const { id, draftId } = useParams()
  const [params] = useSearchParams()
  const from = params.get('from') ?? undefined
  const copy = params.get('copy') ?? undefined
  const newType = params.get('type') ?? 'feat'
  const [start, setStart] = useState<Start | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const source = id ?? from ?? copy
    Promise.all([
      groupApi.core(),
      groupApi.states().catch(() => []),
      allOfType(groupApi, 'skill'),
      Promise.all(['class', 'prestige_class'].map((t) => allOfType(groupApi, t))).then((all) => all.flat()),
      Promise.all(ENTRY_TYPES.map((t) => allOfType(groupApi, t).catch(() => []))),
      source ? groupApi.entity(source) : Promise.resolve(null),
      draftId ? groupApi.draft(draftId) : Promise.resolve(null),
      api.me(),
    ]).then(
      ([core, states, skills, classes, lists, detail, draft, me]) => {
        if (!current) return
        const targets = targetsOf(group.rulesets, me.role === 'admin' && !from)
        const entries = Object.fromEntries(ENTRY_TYPES.map((t, i) => [t, options(lists[i])])) as Record<EntryType, TargetOption[]>
        const names = new Map<string, string>([...options(skills), ...options(classes), ...Object.values(entries).flat()].map((o) => [o.key, o.label]))
        for (const r of detail?.references ?? []) names.set(r.id, localized(r.name) ?? r.id)
        const base = { core, states, skills: options(skills), classes: options(classes), entries, names, targets }
        if (draft) {
          const p = draft.payload
          setStart({ ...base, payload: p, draftId: draft.id, title: p.mode === 'update' ? fr.content.editTitle(entityName(p.entity, p.entity.id)) : p.overrides ? fr.content.houseRuleTitle(entityName(p.entity, p.overrides)) : fr.content.newTitle })
        } else {
          setStart({ ...base, ...startOf(detail, { editing: id != null, copy: copy != null, newType, slug: targets[0]?.slug ?? OFFICIAL }) })
        }
      },
      (e) => current && setError(messageOf(e)),
    )
    return () => {
      current = false
    }
  }, [id, from, copy, newType, draftId])

  if (error) return <ErrorNotice message={error} />
  if (!start) return <Loading />
  if (start.payload.mode === 'create' && start.targets.length === 0) return <NoRuleset />
  return <Editor key={`${start.payload.entity.id}-${start.payload.baseVersion}-${start.draftId}`} start={start} groupApi={groupApi} />
}

/** The group's rulesets the caller edits, in the group's order, then official content for the platform admin. */
function targetsOf(rulesets: GroupRuleset[], official: boolean): Target[] {
  const editable = rulesets.filter((r) => r.editable && !r.archived).map((r) => ({ slug: r.slug, name: r.name }))
  return official ? [...editable, { slug: OFFICIAL, name: fr.content.official }] : editable
}

function NoRuleset() {
  const groupPath = useGroupPath()
  return (
    <>
      <p className="muted">{fr.content.noRuleset}</p>
      <Link className="btn btn-secondary" to={groupPath('/settings')}>{fr.groups.settings}</Link>
    </>
  )
}

/** `slug:feat.x` for a ruleset, `feat.x` for official content. */
function inTarget(slug: string, id: string): string {
  const plain = id.replace(/^[a-z][a-z0-9_]*:/, '')
  return slug === OFFICIAL || !plain ? plain : `${slug}:${plain}`
}

function listsOf(detail: EntityDetail | null): ListDraft[] {
  return (detail?.relations ?? [])
    .filter((r) => r.relation === 'on_spell_list')
    .map((r) => ({ to: r.to, level: r.extra.level == null ? '' : String(r.extra.level) }))
}

function startOf(detail: EntityDetail | null, how: { editing: boolean; copy: boolean; newType: string; slug: string }): Pick<Start, 'payload' | 'title' | 'copiedFrom'> {
  const provenance = how.slug === OFFICIAL ? 'official' : 'team'
  if (detail && how.editing) {
    return {
      payload: { mode: 'update', entity: detail.content, baseVersion: detail.version, spellLists: listsOf(detail), ruleset: detail.ruleset?.slug },
      title: fr.content.editTitle(entityName(detail.content, detail.id)),
    }
  }
  if (detail && how.copy) {
    const name = detail.content.name
    const entity = { ...detail.content, provenance, id: idFrom(detail.content.type, name.en || name.fr || '', how.slug || undefined) }
    return { payload: { mode: 'create', entity, spellLists: listsOf(detail) }, title: fr.content.newTitle, copiedFrom: detail.overrides ?? detail.id }
  }
  if (detail) {
    // A house rule: the content the group sees now, under the ruleset's id; it replaces the official entity.
    const official = detail.overrides ?? detail.id
    return {
      payload: { mode: 'create', entity: { ...detail.content, id: inTarget(how.slug, official), provenance: 'team' }, overrides: official, spellLists: listsOf(detail), idTouched: true },
      title: fr.content.houseRuleTitle(entityName(detail.content, official)),
    }
  }
  return { payload: { mode: 'create', entity: { id: '', type: how.newType, name: {}, provenance } }, title: fr.content.newTitle }
}

/**
 * What a save writes: an `add` with no bonus type is untyped, a `set` with no step is « base » (the engine reads
 * them so already; official content often leaves them out, and the check wants them written).
 */
function normalized(entity: Entity): Entity {
  if (!entity.effects) return entity
  const effects = entity.effects.map((e): Effect => {
    if (e.op === 'add' && !e.bonusType) return { ...e, bonusType: 'untyped' }
    if (e.op === 'set' && !e.layer) return { ...e, layer: 'base' }
    return e
  })
  return { ...entity, effects }
}

/** A new id renames the entry's own state too (« quand on l’active » follows the name). */
function renamed(entity: Entity, id: string): Entity {
  const before = selfToggle(entity.id)
  const after = selfToggle(id)
  const next = { ...entity, id }
  if (!before || before === after || !entity.effects) return next
  const text = JSON.stringify(entity.effects).replaceAll(`'${before}'`, `'${after}'`).replaceAll(`@${before}.`, `@${after}.`)
  return { ...next, effects: JSON.parse(text) as Effect[] }
}

function Editor({ start, groupApi }: { start: Start; groupApi: GroupApi }) {
  const { group } = useGroup()
  const groupPath = useGroupPath()
  const navigate = useNavigate()
  const p = start.payload
  const creating = p.mode === 'create'
  const [entity, setEntity] = useState<Entity>(p.entity)
  const [target, setTarget] = useState(p.ruleset ?? start.targets[0]?.slug ?? OFFICIAL)
  const [idTouched, setIdTouched] = useState(p.idTouched ?? !creating)
  const [note, setNote] = useState(p.note ?? '')
  const [lists, setLists] = useState<ListDraft[]>(p.spellLists ?? [])
  const [names, setNames] = useState(start.names)
  const [entries, setEntries] = useState(start.entries)
  const [draftId, setDraftId] = useState(start.draftId)
  const [draftState, setDraftState] = useState<{ saving: boolean; at?: string }>({ saving: false })
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<EntityDetail | null>(null)
  const tried = useRef(new Set<string>())

  const change = (next: Entity) => {
    let result = next
    if (creating && !idTouched && !p.overrides) {
      const id = idFrom(next.type, next.name?.en || next.name?.fr || '', target || undefined)
      if (id !== next.id) result = renamed(next, id)
    }
    setEntity(result)
  }
  const chooseTarget = (slug: string) => {
    setTarget(slug)
    setEntity((e) => renamed({ ...e, provenance: slug === OFFICIAL ? 'official' : 'team' }, inTarget(slug, e.id)))
  }
  const addName = (id: string, name: string) => setNames((n) => (n.get(id) === name ? n : new Map(n).set(id, name)))

  // Ids written in the content (a prerequisite typed by hand, a copied entry) get their names from the group.
  const entityJson = JSON.stringify(entity)
  useEffect(() => {
    const timer = setTimeout(() => {
      const ids = [...new Set(entityJson.match(ID_IN_TEXT) ?? [])].filter((id) => !names.has(id) && !tried.current.has(id) && id !== entity.id)
      for (const id of ids.slice(0, 20)) {
        tried.current.add(id)
        entityInfo(groupApi, id).then((d) => addName(id, entityName(d.content, id)), () => undefined)
      }
    }, NAMES_DELAY_MS)
    return () => clearTimeout(timer)
  }, [entityJson])

  const isSpell = entity.type === 'spell'
  const [listOptions, setListOptions] = useState<EntitySummary[]>([])
  useEffect(() => {
    if (!isSpell) return
    Promise.all(LIST_TYPES.map((type) => allOfType(groupApi, type))).then((all) => setListOptions(all.flat()), () => setListOptions([]))
  }, [isSpell])
  const listName = (id: string) => names.get(id) ?? localized(listOptions.find((o) => o.id === id)?.name) ?? id

  const toSave = useMemo(() => normalized(entity), [entity])
  const checked = useCheck(toSave, start.core)
  const issues = [
    ...(checked ?? []).map((i) => ({ at: i.at, text: `${fr.content.issues[i.code] ?? i.code} (${i.message})` })),
    ...(entity.effects ?? []).flatMap((e, i) => (e.target ? [] : [{ at: `effects[${i}].target`, text: fr.cms.effects.noStatistic }])),
  ]
  const listProblems = isSpell ? checkLists(lists, listName) : []
  const nameMissing = !localized(entity.name)
  const sameId = start.copiedFrom != null && entity.id === start.copiedFrom
  const problems = issues.length + listProblems.length + (nameMissing ? 1 : 0) + (sameId || !entity.id ? 1 : 0)
  const blocked = checked == null || problems > 0

  const payload = (): DraftPayload => ({
    entity,
    mode: p.mode,
    ...(creating ? (target ? { ruleset: target } : {}) : p.ruleset ? { ruleset: p.ruleset } : {}),
    ...(p.overrides ? { overrides: p.overrides } : {}),
    ...(p.baseVersion != null ? { baseVersion: p.baseVersion } : {}),
    ...(isSpell ? { spellLists: lists } : {}),
    ...(note ? { note } : {}),
    idTouched,
  })

  async function saveDraft() {
    setDraftState((s) => ({ ...s, saving: true }))
    try {
      const saved = draftId ? await groupApi.saveDraft(draftId, payload()) : await groupApi.createDraft(payload())
      setDraftId(saved.id)
      setDraftState({ saving: false, at: new Date(saved.updatedAt).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }) })
    } catch (e) {
      setDraftState({ saving: false })
      setSaveError(messageOf(e))
    }
  }

  // Once a draft exists, it keeps up with the typing.
  const payloadJson = JSON.stringify(payload())
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!draftId) return
    const timer = setTimeout(() => void saveDraft(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [payloadJson])

  async function publish() {
    if (blocked) return
    setBusy(true)
    setSaveError(null)
    try {
      const spellLists: SpellLevel[] | undefined = isSpell ? lists.map((l) => ({ to: l.to, level: Number(l.level) })) : undefined
      const saved = creating
        ? await api.createEntity(toSave, note, { ...(target ? { ruleset: target } : {}), ...(p.overrides ? { overrides: p.overrides } : {}) }, spellLists)
        : await api.updateEntity(toSave, p.baseVersion!, note, spellLists)
      if (draftId) await groupApi.deleteDraft(draftId).catch(() => undefined)
      forgetLists()
      forgetEntityInfo(saved.id, ...(p.overrides ? [p.overrides] : []))
      navigate(groupPath(`/catalog/entity/${p.overrides ?? saved.id}`))
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

  /** A book, statistic or situation made from a dropdown: published at once, next to the entry being edited. */
  async function createEntry(type: EntryType, name: Localized): Promise<string> {
    const id = idFrom(type, name.en || name.fr || '', target || undefined)
    const saved = await api.createEntity({ id, type, name, provenance: target === OFFICIAL ? 'official' : 'team' },
      fr.cms.entries.note(localized(entity.name) ?? entity.id), target ? { ruleset: target } : {})
    const label = localized(saved.content.name) ?? saved.id
    setEntries((all) => ({ ...all, [type]: [...all[type], { key: saved.id, label }] }))
    addName(saved.id, label)
    forgetLists()
    return saved.id
  }

  const back = creating ? (p.overrides ? groupPath(`/catalog/entity/${p.overrides}`) : groupPath('/atelier')) : groupPath(`/catalog/entity/${entity.id}`)
  const cms: CmsData = {
    groupApi,
    names: nameMissing ? names : new Map([...names, [entity.id, localized(entity.name)!]]),
    addName,
    skills: start.skills,
    classes: start.classes,
    states: start.states,
    bonusTypes: (start.core.bonusTypes ?? []).map((b) => ({ key: b.id, label: bonusTypeNames[b.id] ?? localized(b.name) ?? b.id })),
    selfId: entity.id,
    type: entity.type,
    entries,
    rulesets: group.rulesets.map((r) => ({ slug: r.slug, name: r.name })),
    createIn: start.targets.find((t) => t.slug === target) ?? null,
    createEntry,
    repeatable: entity.repeatable ? (entity.repeatable.choose ?? '') : null,
    tableValue: entity.tableValue != null,
    issues,
  }
  const ruleset = start.targets.find((t) => t.slug === target)?.name

  const idField = (
    <div className="cms-id">
      <span className="field-hint">{fr.content.id} : <code>{entity.id || '—'}</code>{creating && ` · ${fr.cms.idHint}`}</span>
      {sameId && <p className="warning" role="alert">{fr.cms.sameId}</p>}
    </div>
  )
  // From « Avancé »: a new id typed there while creating is kept (and the entry's own state follows it).
  const replace = (next: Entity) => {
    if (creating && next.id !== entity.id) {
      setIdTouched(true)
      setEntity(renamed({ ...next, id: entity.id }, next.id.trim()))
    } else if (!creating && next.id !== entity.id) {
      setEntity({ ...next, id: entity.id })
    } else change(next)
  }

  return (
    <CmsContext.Provider value={cms}>
      <header className="page-head">
        <div className="page-head-row">
          <h1 className="type-display-l">{start.title}</h1>
          <Link className="btn btn-secondary btn-small" to={back}>{fr.content.cancel}</Link>
        </div>
      </header>

      <div className="cms-layout">
        <div className="cms-form">
          {creating && (
            <div className="cms-place">
              <div className="cms-ruleset">
                <p>{fr.cms.placedIn} <strong>{ruleset}</strong></p>
                {ruleset && <p className="field-hint">{fr.cms.visibleIn(ruleset)}</p>}
                {p.overrides && <p className="field-hint">{fr.content.houseRuleHint}</p>}
                {start.targets.length > 1 && (
                  <label className="cms-inline">
                    <span className="cms-sublabel">{fr.cms.changeRuleset}</span>
                    <select className="input" value={target} onChange={(e) => chooseTarget(e.target.value)}>
                      {start.targets.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {!p.overrides && !start.copiedFrom && (
                <label className="field">
                  <span className="cms-sublabel">{fr.content.type}</span>
                  <select className="input" value={entity.type} onChange={(e) => change({ ...entity, type: e.target.value })}>
                    {entityTypes.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <FormEngine schema={formFor(entity.type)} entity={entity} onChange={change} onReplace={replace} idField={idField}
            extra={isSpell && <SpellLevels lists={lists} setLists={setLists} options={listOptions} listName={listName} />} />
        </div>

        <aside className="cms-aside">
          <h2 className="type-heading">{fr.cms.preview}</h2>
          <LiveCard entity={entity} ruleset={p.overrides ? undefined : ruleset} houseRule={p.overrides != null}
            spellLevels={isSpell ? lists.filter((l) => l.to).map((l) => ({ to: l.to, level: Number(l.level) })) : []} />

          <section className="publish">
            {checked == null ? <p className="muted">{fr.content.checking}</p> : problems === 0 ? (
              <p className="publish-ok">{fr.cms.ready}</p>
            ) : (
              <p className="warning">{fr.cms.problems(problems)}</p>
            )}
            {issues.filter((i) => !/^(effects|prerequisite|usesPerDay)/.test(i.at)).map((i) => <p key={i.at + i.text} className="warning">{i.text}</p>)}
            {listProblems.map((problem) => <p key={problem} className="warning">{problem}</p>)}
            <label className="field">
              <span className="cms-sublabel">{fr.cms.note}</span>
              <input className="input" value={note} placeholder={fr.content.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
            </label>
            {saveError && <ErrorNotice message={saveError} />}
            {conflict && (
              <div className="notice warning" role="alert">
                <p>{fr.content.conflict(conflict.version)}</p>
                <button className="btn btn-secondary btn-small"
                  onClick={() => navigate(0)}>{fr.content.takeCurrent}</button>
              </div>
            )}
            <div className="button-row">
              <button className="btn btn-secondary" disabled={draftState.saving} onClick={() => void saveDraft()}>
                {draftState.saving ? fr.cms.draftSaving : fr.cms.draft}
              </button>
              <button className="btn btn-primary" disabled={busy || blocked} onClick={() => void publish()}>
                {busy ? fr.cms.publishing : fr.cms.publish}
              </button>
            </div>
            {draftState.at && <p className="field-hint" role="status">{fr.cms.draftSaved(draftState.at)}</p>}
          </section>
        </aside>
      </div>
    </CmsContext.Provider>
  )
}

function SpellLevels({ lists, setLists, options, listName }: {
  lists: ListDraft[]
  setLists: (update: (lists: ListDraft[]) => ListDraft[]) => void
  options: EntitySummary[]
  listName: (id: string) => string
}) {
  return (
    <Field label={fr.content.spellLevels} description={fr.content.spellLevelsHint}>
      {lists.map((line, i) => (
        <div key={i} className="list-line">
          <label className="field">
            <span className="cms-sublabel">{fr.content.list}</span>
            <select className="input" value={line.to} onChange={(e) => setLists((ls) => ls.map((l, j) => (j === i ? { ...l, to: e.target.value } : l)))}>
              <option value="">{fr.editor.pick}</option>
              {line.to && !options.some((o) => o.id === line.to) && <option value={line.to}>{line.to}</option>}
              <ListOptions options={options} type="class" label={fr.editor.baseClasses} />
              <ListOptions options={options} type="prestige_class" label={fr.editor.prestigeClasses} />
              <ListOptions options={options} type="domain" label={fr.content.domains} />
            </select>
          </label>
          <label className="field list-level">
            <span className="cms-sublabel">{fr.content.level}</span>
            <input className="input" type="number" inputMode="numeric" min="0" max={MAX_SPELL_LEVEL} value={line.level}
              onChange={(e) => setLists((ls) => ls.map((l, j) => (j === i ? { ...l, level: e.target.value } : l)))} />
          </label>
          <button type="button" className="icon-button" aria-label={fr.content.removeList(listName(line.to))}
            onClick={() => setLists((ls) => ls.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setLists((ls) => [...ls, { to: '', level: '' }])}>
          {fr.content.addList}
        </button>
      </div>
    </Field>
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
function useCheck(entity: Entity, core: CoreSections) {
  const coreJson = useMemo(() => JSON.stringify(core), [core])
  const entityJson = JSON.stringify(entity)
  const [result, setResult] = useState<{ json: string; issues: { code: string; at: string; message: string }[] } | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      const issues = ContentCheck.getInstance().entity(entityJson, coreJson).asJsReadonlyArrayView()
      setResult({ json: entityJson, issues: issues.map((i) => ({ code: i.code, at: i.at, message: i.message })) })
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [entityJson, coreJson])
  return result && result.json === entityJson ? result.issues : null
}


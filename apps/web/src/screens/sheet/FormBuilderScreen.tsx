import { SheetEngine, type FormPreview } from 'dnd-engine'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Character, Closure, EntitySummary, SavedForm } from '../../api/types'
import { ErrorNotice, Loading, StatBlock } from '../../components/grimoire'
import { EntityName } from '../../components/EntityPanel'
import { Picker } from '../../components/Picker'
import { formatNumber } from '../../format'
import { abilities, fr, statLabels } from '../../i18n/fr'
import { useGroupApi, useGroupPath } from '../../group/GroupContext'
import { allOfType } from '../../sheet/catalogLists'
import { entityName, localized } from '../../sheet/names'
import { useSheet } from '../../sheet/SheetContext'
import { labelLine } from '../../rpg/dnd35/labels'
import { messageOf } from '../../useLoad'

/** Abilities a +1 of extra hit dice can go to: a form only replaces the physical ones. */
const PHYSICAL = abilities.filter((a) => ['str', 'dex', 'con'].includes(a.id))

/**
 * The transformation builder: a source (Wild Shape, Polymorph…), a creature, its hit dice (the most allowed by
 * default), where the +1 of the extra hit dice go, and whether equipment keeps working. Previewed live with the
 * engine's `previewForm` on the draft's catalog, then saved into `character.forms`.
 */
export function FormBuilderScreen() {
  const groupApi = useGroupApi()
  const groupPath = useGroupPath()
  const navigate = useNavigate()
  const { record, closure: sheetClosure, stat, saveCharacter, reload } = useSheet()
  const character = record.character
  const forms = character.forms ?? []

  const sources = sheetClosure.catalog.entities
    .filter((e) => e.shaping && !e.shaping.extends)
    .sort((a, b) => entityName(a, a.id).localeCompare(entityName(b, b.id), 'fr'))
  const [source, setSource] = useState(sources[0]?.id ?? '')
  const [creatures, setCreatures] = useState<EntitySummary[] | null>(null)
  const [creature, setCreature] = useState('')
  const [hitDice, setHitDice] = useState<number | null>(null)
  const [increases, setIncreases] = useState<string[]>([])
  const [keepEquipment, setKeepEquipment] = useState(false)
  const [formName, setFormName] = useState('')
  const [closure, setClosure] = useState<Closure | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    allOfType(groupApi, 'creature').then(setCreatures, (e) => setError(messageOf(e)))
  }, [])

  const creatureName = (id: string) => localized(creatures?.find((c) => c.id === id)?.name) ?? id
  const id = useMemo(() => uniqueId(formName || creatureName(creature), forms), [formName, creature, creatures, forms])

  const base: SavedForm | null = source && creature ? { id, creature, source } : null
  const draft: Character | null = base ? { ...character, forms: [...forms, base] } : null

  // The catalog the draft needs (the creature is not in the sheet's yet): fetched again when the creature or source changes.
  useEffect(() => {
    if (!draft) return
    let current = true
    setClosure(null)
    groupApi.draftCatalog(draft).then((c) => current && setClosure(c), (e) => current && setError(messageOf(e)))
    return () => {
      current = false
    }
  }, [creature, source])

  const engine = useMemo(() => (closure ? new SheetEngine(JSON.stringify(closure.catalog)) : null), [closure])
  const draftSheet = useMemo(() => (engine && draft ? engine.open(JSON.stringify(draft), 0) : null), [engine, creature, source])
  const creatureInfo = closure?.catalog.entities.find((e) => e.id === creature)?.creature
  // The most hit dice allowed: from the form at its default, which does not depend on the choices below.
  const maxHitDice = useMemo(() => (draftSheet && base ? Number(draftSheet.previewForm(JSON.stringify(base)).form.maxHitDice ?? 0) : 0), [draftSheet])
  const minHitDice = creatureInfo?.hitDice ?? 1
  const shownHitDice = Math.min(Math.max(hitDice ?? maxHitDice, minHitDice), Math.max(maxHitDice, minHitDice))
  const points = creatureInfo ? Math.max(0, Math.floor(shownHitDice / 4) - Math.floor(creatureInfo.hitDice / 4)) : 0
  const placed = Array.from({ length: points }, (_, i) => increases[i] ?? 'str')

  const form: SavedForm | null = base
    ? {
        ...base,
        ...(formName ? { name: formName } : {}),
        ...(hitDice != null && hitDice < maxHitDice ? { hitDice: shownHitDice } : {}),
        ...(placed.length ? { abilityIncreases: placed } : {}),
        ...(keepEquipment ? { keepEquipment } : {}),
      }
    : null
  const preview: FormPreview | null = useMemo(
    () => (draftSheet && form ? draftSheet.previewForm(JSON.stringify(form)) : null),
    [draftSheet, JSON.stringify(form)],
  )

  async function save() {
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      await saveCharacter({ ...character, forms: [...forms, form] })
      reload()
      navigate(groupPath(`/characters/${record.id}/build`))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const size = (s?: string | null) => (s ? fr.forms.sizes[s] ?? s : '')
  const show = (key: string, v: string) => (key === 'size' ? size(v) : key.startsWith('speed.') ? `${formatNumber(v)} m` : formatNumber(v))

  return (
    <>
      <header className="page-head">
        <h1 className="type-display-l">{fr.forms.newForm}</h1>
      </header>
      {error && <ErrorNotice message={error} />}

      <StatBlock title={fr.forms.source}>
        {sources.length === 0 ? (
          <p className="muted">{fr.forms.noSource}</p>
        ) : (
          <label className="field">
            <span>{fr.forms.source}</span>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((s) => <option key={s.id} value={s.id}>{entityName(s, s.id)}</option>)}
            </select>
          </label>
        )}
      </StatBlock>

      <StatBlock title={fr.forms.creature} aside={creature && <EntityName id={creature}>{creatureName(creature)}</EntityName>}>
        {creatures ? (
          <Picker label={fr.forms.pickCreature}
            items={creatures.map((c) => ({ id: c.id, name: localized(c.name) ?? c.id, sub: labelLine('creature', (c.labels ?? []).filter((l) => l !== 'creature')) }))
              .sort((a, b) => a.name.localeCompare(b.name, 'fr'))}
            onPick={(picked) => { setCreature(picked); setHitDice(null); setIncreases([]) }} />
        ) : (
          <Loading />
        )}
      </StatBlock>

      {creature && !preview && <p className="muted">{fr.forms.loading}</p>}

      {preview && creatureInfo && (
        <>
          <StatBlock title={fr.forms.hitDice} aside={<span className="muted">{shownHitDice >= maxHitDice ? fr.forms.atMax : fr.forms.atMost(String(maxHitDice))}</span>}>
            <span className="stepper">
              <button type="button" aria-label={fr.sheet.less} disabled={shownHitDice <= minHitDice}
                onClick={() => setHitDice(shownHitDice - 1)}>−</button>
              <output aria-live="polite">{fr.forms.facts(size(preview.form.size), String(shownHitDice))}</output>
              <button type="button" aria-label={fr.sheet.more} disabled={shownHitDice >= maxHitDice}
                onClick={() => setHitDice(shownHitDice + 1)}>+</button>
            </span>
            {points > 0 && (
              <>
                <p>{fr.forms.points(points)}</p>
                <div className="chips">
                  {placed.map((ability, i) => (
                    <label className="field" key={i}>
                      <span>{fr.forms.point(i + 1)}</span>
                      <select className="input" value={ability}
                        onChange={(e) => setIncreases(placed.map((a, j) => (j === i ? e.target.value : a)))}>
                        {PHYSICAL.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
          </StatBlock>

          <StatBlock title={fr.forms.preview}>
            <dl className="facts" aria-label={fr.forms.changes}>
              {preview.stats.asJsReadonlyArrayView().map((s) => {
                const before = stat(s.key)
                if (before === s.text && !s.key.startsWith('ability.')) return null
                return (
                  <div key={s.key} style={{ display: 'contents' }}>
                    <dt>{fr.forms.stats[s.key] ?? statLabels[s.key] ?? s.key}</dt>
                    <dd>{before != null && before !== s.text ? `${show(s.key, before)} → ` : ''}<strong>{show(s.key, s.text)}</strong></dd>
                  </div>
                )
              })}
            </dl>
            {preview.form.issues.asJsReadonlyArrayView().map((code) => (
              <p key={code} className="warning">{fr.forms.issues[code] ?? code}</p>
            ))}
            <label className="toggle-row">
              <span className="toggle-text">
                <span className="toggle-name">{fr.forms.keepEquipment}</span>
                <span className="muted">{fr.forms.keepEquipmentHint}</span>
              </span>
              <input type="checkbox" checked={keepEquipment} onChange={(e) => setKeepEquipment(e.target.checked)} />
            </label>
            <label className="field">
              <span>{fr.forms.name}</span>
              <input className="input" value={formName} placeholder={creatureName(creature)} onChange={(e) => setFormName(e.target.value)} />
            </label>
          </StatBlock>

          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? fr.build.saving : fr.forms.save}
          </button>
        </>
      )}
    </>
  )
}

/** `form.ours_de_guerre`, with a number when the character already has that id. */
function uniqueId(label: string, forms: SavedForm[]): string {
  const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'form'
  let id = `form.${slug}`
  for (let n = 2; forms.some((f) => f.id === id); n++) id = `form.${slug}_${n}`
  return id
}

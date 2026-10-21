import { useState } from 'react'
import type { Effect } from '../api/types'
import { fr } from '../i18n/fr'
import { bonusText, effectText, metamagicText, stateName } from '../rpg/dnd35/describe'
import { parseValue, parseWhen, selfToggle, situationName, whenFields, type When } from '../rpg/dnd35/formulas'
import {
  blocksOf, DOUBLED, effectsOf, newBonus, newFree, newMetamagic, newSynergy, RECIPES, recipe,
  type Block, type BonusBlock, type FreeBlock, type MetamagicBlock, type MetamagicRecipe,
} from '../rpg/dnd35/recipes'
import { CHOICE_TARGETS, targetGroups, targetLabel } from '../rpg/dnd35/targets'
import { issuesAt, useCms } from './context'
import { EntrySelect } from './EntrySelect'
import { ListPick, MultiPick, useSynced } from './fields'
import { ValueField } from './ValueField'

const FREE_OPS = ['add', 'multiply', 'set', 'min', 'max', 'dice']
const METAMAGIC: MetamagicRecipe[] = ['slotCost', 'numeric', 'double']

function blockTitle(block: Block): string {
  if (block.kind === 'bonus') return recipe(block.recipe)?.label ?? ''
  if (block.kind === 'metamagic') return fr.cms.metamagic[block.recipe]
  return fr.cms.effects.free
}

/**
 * The effects as cards: a recipe card for the common kinds (« Bonus à des compétences »), a sentence for the others.
 * « Ajouter un effet » opens the recipes. Each card reads back as a sentence, as the catalog will show it.
 */
export function EffectsField({ value, onChange, onOpenUses }: { value: Effect[]; onChange: (effects: Effect[] | undefined) => void; onOpenUses?: () => void }) {
  const { issues, type, selfId } = useCms()
  const [blocks, setBlocks] = useSynced(value, blocksOf, effectsOf)
  const [gallery, setGallery] = useState(value.length === 0)
  const emit = (next: Block[]) => {
    const effects = setBlocks(next)
    onChange(effects.length ? effects : undefined)
  }
  const replace = (i: number, block: Block) => emit(blocks.map((b, j) => (j === i ? block : b)))
  const add = (block: Block) => {
    emit([...blocks, block])
    setGallery(false)
  }

  let first = 0
  return (
    <>
      {blocks.map((block, i) => {
        const count = block.kind === 'bonus' ? block.targets.length : 1
        const at = Array.from({ length: count }, (_, k) => issuesAt(issues, `effects[${first + k}]`)).flat()
        first += count
        return (
          <article key={i} className="effect-block">
            <header className="effect-block-head">
              <span className="effect-block-kind">{blockTitle(block)}</span>
              <span className="button-row">
                {i > 0 && (
                  <button type="button" className="icon-button" aria-label={fr.cms.effects.moveUp}
                    onClick={() => emit(blocks.map((b, j) => (j === i - 1 ? block : j === i ? blocks[i - 1] : b)))}>↑</button>
                )}
                <button type="button" className="icon-button" aria-label={fr.cms.remove} onClick={() => emit(blocks.filter((_, j) => j !== i))}>×</button>
              </span>
            </header>
            {block.kind === 'bonus' && <BonusCard block={block} onChange={(b) => replace(i, b)} />}
            {block.kind === 'free' && <FreeCard block={block} onChange={(b) => replace(i, b)} />}
            {block.kind === 'metamagic' && <MetamagicCard block={block} onChange={(b) => replace(i, b)} />}
            {at.map((issue) => <p key={issue} className="warning" role="alert">{issue}</p>)}
          </article>
        )
      })}
      {gallery ? (
        <div className="recipe-gallery">
          <div className="block-head">
            <span className="cms-sublabel">{fr.cms.effects.gallery}</span>
            {blocks.length > 0 && <button type="button" className="link-button" onClick={() => setGallery(false)}>{fr.cms.effects.cancel}</button>}
          </div>
          <div className="recipe-grid">
            {type === 'skill' && (
              <button type="button" className="recipe" onClick={() => add(newSynergy(selfId))}>
                <strong>{fr.cms.synergy.label}</strong>
                <span>{fr.cms.synergy.hint}</span>
              </button>
            )}
            {type === 'feat' && METAMAGIC.map((m) => (
              <button key={m} type="button" className="recipe" onClick={() => add(newMetamagic(m))}>
                <strong>{fr.cms.metamagic[m]}</strong>
                <span>{fr.cms.metamagic[`${m}Hint`]}</span>
              </button>
            ))}
            {RECIPES.map((r) => (
              <button key={r.id} type="button" className="recipe" onClick={() => add(newBonus(r.id))}>
                <strong>{r.label}</strong>
                <span>{r.description}</span>
              </button>
            ))}
            {onOpenUses && (
              <button type="button" className="recipe" onClick={() => { onOpenUses(); setGallery(false) }}>
                <strong>{fr.cms.effects.uses}</strong>
                <span>{fr.cms.effects.usesHint}</span>
              </button>
            )}
            <button type="button" className="recipe recipe-free" onClick={() => add(newFree())}>
              <strong>{fr.cms.effects.free}</strong>
              <span>{fr.cms.effects.freeHint}</span>
            </button>
          </div>
        </div>
      ) : (
        <div><button type="button" className="btn btn-secondary btn-small" onClick={() => setGallery(true)}>{fr.cms.add(fr.cms.effects.add)}</button></div>
      )}
    </>
  )
}

/** Picking « la valeur choisie » makes sense only while the entry is on: « Toujours » becomes « quand on l’active ». */
function usesTable(value: string | number, selfId: string): boolean {
  return parseValue(value, selfToggle(selfId)).kind === 'table'
}

function BonusCard({ block, onChange }: { block: BonusBlock; onChange: (block: BonusBlock) => void }) {
  const { names, skills, selfId, repeatable } = useCms()
  const r = recipe(block.recipe)!
  const choice = repeatable ? CHOICE_TARGETS[repeatable] : undefined
  const suggested = choice && r.accepts(choice.key) ? [choice] : []
  const options = [...suggested, ...(r.options ?? skills)]
  const set = (patch: Partial<BonusBlock>) => onChange({ ...block, ...patch })
  return (
    <>
      <p className="effect-sentence">{bonusText(block.targets, block.value, block.bonusType || undefined, block.when, names)}</p>
      <div className="cms-subfield">
        <span className="cms-sublabel">{fr.cms.effects.targets}</span>
        {r.options && options.length <= 12 ? (
          <div className="chips">
            {options.map((o) => (
              <button key={o.key} type="button" className="chip" aria-pressed={block.targets.includes(o.key)}
                onClick={() => set({ targets: block.targets.includes(o.key) ? block.targets.filter((t) => t !== o.key) : [...block.targets, o.key] })}>
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <MultiPick value={block.targets} options={r.options ?? skills} suggested={suggested} searchLabel={fr.cms.effects.searchSkill} onChange={(targets) => set({ targets })} />
        )}
        {block.targets.length === 0 && <p className="warning">{fr.cms.effects.noTarget}</p>}
      </div>
      <ValueField value={block.value} onChange={(value) => set({ value, ...(usesTable(value, selfId) && block.when.kind === 'always' ? { when: { kind: 'toggle', id: selfToggle(selfId) } } : {}) })} />
      <BonusTypeSelect value={block.bonusType} onChange={(bonusType) => set({ bonusType })} />
      <WhenPicker value={block.when} onChange={(when) => set({ when })} />
    </>
  )
}

function BonusTypeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { bonusTypes } = useCms()
  return (
    <label className="field">
      <span className="cms-sublabel">{fr.cms.effects.bonusType}</span>
      <select className="input" value={value} title={fr.cms.effects.bonusTypeHint} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">{fr.cms.effects.noBonusType}</option>}
        {value && !bonusTypes.some((b) => b.key === value) && <option value={value}>{value}</option>}
        {bonusTypes.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
      </select>
    </label>
  )
}

type WhenChoice = When['kind'] | 'self'

/** « Toujours », « quand on l’active », « quand Rage est active », « avec 5 rangs en Saut », « contre le poison »… */
export function WhenPicker({ value, onChange }: { value: When; onChange: (when: When) => void }) {
  const { states, names, selfId, skills } = useCms()
  const self = selfToggle(selfId)
  const choice: WhenChoice = value.kind === 'toggle' && value.id === self ? 'self' : value.kind
  const toggles = states.filter((s) => s.kind === 'toggle' && s.id !== self)

  const choose = (kind: WhenChoice) => {
    if (kind === 'self') onChange({ kind: 'toggle', id: self })
    else if (kind === 'always') onChange({ kind })
    else if (kind === 'toggle') onChange({ kind, id: toggles[0]?.id ?? '' })
    else if (kind === 'situation') onChange({ kind, id: '' })
    else if (kind === 'ranks') onChange({ kind, skill: '', min: 5 })
    else onChange({ kind: 'formula', condition: whenFields(value).condition ?? '' })
  }
  const kinds: WhenChoice[] = ['always', 'self', 'toggle', 'situation', 'ranks', ...(choice === 'formula' ? ['formula' as const] : [])]

  return (
    <div className="cms-subfield">
      <label className="field">
        <span className="cms-sublabel">{fr.cms.when.label}</span>
        <select className="input" value={choice} onChange={(e) => choose(e.target.value as WhenChoice)}>
          {kinds.map((k) => (
            <option key={k} value={k} disabled={(k === 'self' && !self) || k === 'formula'}>
              {k === 'self' && !self ? fr.cms.when.selfNoName : fr.cms.when.kinds[k]}
            </option>
          ))}
        </select>
      </label>
      {choice === 'self' && <p className="field-hint">{fr.cms.when.selfHint}</p>}
      {value.kind === 'toggle' && choice === 'toggle' && (
        <select className="input" value={value.id} aria-label={fr.cms.when.state} onChange={(e) => onChange({ kind: 'toggle', id: e.target.value })}>
          {!toggles.some((t) => t.id === value.id) && <option value={value.id}>{stateName(value.id, names)}</option>}
          {toggles.map((t) => {
            const users = t.usedBy.map((u) => names.get(u.id) ?? u.name?.fr ?? u.name?.en ?? u.id)
            return <option key={t.id} value={t.id}>{stateName(t.id, new Map([...names, ...t.usedBy.map((u) => [u.id, u.name?.fr ?? u.name?.en ?? u.id] as [string, string])]))} — {fr.cms.when.usedBy(users.join(', '))}</option>
          })}
        </select>
      )}
      {value.kind === 'situation' && (
        <>
          <EntrySelect type="situation" value={value.id} label={fr.cms.when.kinds.situation}
            nameOf={(id) => names.get(id) ?? situationName(id)} onChange={(id) => onChange({ kind: 'situation', id })} />
          {!value.id && <p className="warning">{fr.cms.when.noSituation}</p>}
          <p className="field-hint">{fr.cms.when.situationHint}</p>
        </>
      )}
      {value.kind === 'ranks' && (
        <div className="cms-row-inputs">
          <ListPick value={value.skill} options={skills} label={fr.cms.when.skill} onChange={(skill) => onChange({ ...value, skill })} />
          <span className="muted">≥</span>
          <input className="input input-number" type="number" min={0} value={value.min} aria-label={fr.cms.when.ranks}
            onChange={(e) => onChange({ ...value, min: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
        </div>
      )}
      {(value.kind === 'ranks' || (value.kind === 'toggle' && value.situation)) && (
        <div className="field">
          <span className="cms-sublabel">{fr.cms.when.onlyIn}</span>
          <EntrySelect type="situation" value={value.situation ?? ''} label={fr.cms.when.onlyIn}
            nameOf={(id) => names.get(id) ?? situationName(id)} onChange={(id) => onChange({ ...value, situation: id || undefined })} />
        </div>
      )}
      {value.kind === 'formula' && <p className="field-hint">{fr.cms.asWritten} <code>{value.condition}</code></p>}
    </div>
  )
}

/** Any effect, said as a sentence with a picker in each slot; « Avancé » shows its JSON. */
function FreeCard({ block, onChange }: { block: FreeBlock; onChange: (block: FreeBlock) => void }) {
  const { names, skills, selfId, repeatable } = useCms()
  const e = block.effect
  const set = (patch: Partial<Effect>) => {
    const next: Record<string, unknown> = { ...e, ...patch }
    for (const [k, v] of Object.entries(next)) if (v === undefined || v === '') delete next[k]
    if (next.value === undefined) next.value = ''
    onChange({ kind: 'free', effect: next as unknown as Effect })
  }
  // A choice not filled in yet (no situation typed, no skill picked) writes nothing: keep it here, or it would read
  // back as « Toujours ». It stands while the effect still says what it wrote.
  const [pending, setPending] = useState<When | null>(null)
  const written = JSON.stringify({ condition: e.condition, situation: e.situation })
  const matches = (w: When) => JSON.stringify({ condition: undefined, situation: undefined, ...whenFields(w) }) === written
  const when = pending && matches(pending) ? pending : parseWhen(e.condition, e.situation)

  return (
    <>
      <p className="effect-sentence">{e.target ? effectText(e, names) : '…'}</p>
      <div className="cms-row-inputs">
        <label className="field">
          <span className="cms-sublabel">{fr.cms.effects.op}</span>
          <select className="input" value={e.op} onChange={(ev) => set({ op: ev.target.value })}>
            {!FREE_OPS.includes(e.op) && <option value={e.op}>{e.op}</option>}
            {FREE_OPS.map((op) => <option key={op} value={op}>{fr.cms.effects.ops[op]}</option>)}
          </select>
        </label>
      </div>
      <ValueField value={e.value} dice={e.op === 'dice'} onChange={(value) => {
        if (usesTable(value, selfId) && !e.condition && !e.situation) {
          const when = { kind: 'toggle', id: selfToggle(selfId) } as const
          setPending(when)
          set({ value, ...whenFields(when) })
        } else set({ value })
      }} />
      <div className="field">
        <span className="cms-sublabel">{fr.cms.effects.target}</span>
        <EntrySelect type="statistic" value={e.target} label={fr.cms.effects.target} builtIn={targetGroups(skills, repeatable)}
          nameOf={(key) => targetLabel(key, names)} onChange={(target) => set({ target })} />
      </div>
      <div className="cms-row-inputs">
        {e.op === 'add' && <BonusTypeSelect value={e.bonusType ?? ''} onChange={(bonusType) => set({ bonusType })} />}
        {e.op === 'set' && (
          <label className="field">
            <span className="cms-sublabel">{fr.cms.effects.layer}</span>
            <select className="input" value={e.layer ?? 'base'} onChange={(ev) => set({ layer: ev.target.value as Effect['layer'] })}>
              {Object.entries(fr.content.layers).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        {e.op === 'multiply' && (
          <label className="field">
            <span className="cms-sublabel">{fr.cms.effects.multMode}</span>
            <select className="input" value={e.multMode ?? 'additive'} onChange={(ev) => set({ multMode: ev.target.value })}>
              {e.multMode && !(e.multMode in fr.cms.effects.multModes) && <option value={e.multMode}>{e.multMode}</option>}
              {Object.entries(fr.cms.effects.multModes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="cms-sublabel">{fr.cms.effects.scope}</span>
          <select className="input" value={e.scope ?? ''} onChange={(ev) => set({ scope: (ev.target.value || undefined) as Effect['scope'] })}>
            {Object.entries(fr.cms.effects.scopes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </div>
      <WhenPicker value={when} onChange={(w) => {
        setPending(w)
        const fields = whenFields(w)
        set({ condition: fields.condition, situation: fields.situation })
      }} />
    </>
  )
}

/** « Le sort prend un emplacement de [1] niveau plus haut », « Multiplie [la durée] du sort par [2] ». */
function MetamagicCard({ block, onChange }: { block: MetamagicBlock; onChange: (block: MetamagicBlock) => void }) {
  const e = block.effect
  const t = fr.cms.metamagic
  const set = (patch: Partial<Effect>) => onChange({ ...block, effect: { ...e, ...patch } })
  const label = block.recipe === 'slotCost' ? t.slotCostLabel : t.numericLabel
  return (
    <>
      <p className="effect-sentence">{metamagicText(e)}</p>
      <div className="cms-row-inputs">
        {block.recipe === 'double' && (
          <label className="field">
            <span className="cms-sublabel">{t.doubleWhat}</span>
            <select className="input" value={e.target} onChange={(ev) => set({ target: ev.target.value })}>
              {DOUBLED.map((d) => <option key={d} value={d}>{t.doubleTargets[d]}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="cms-sublabel">{label}</span>
          <input className="input input-number" type="number" inputMode="decimal" min={block.recipe === 'slotCost' ? 0 : 1}
            step={block.recipe === 'slotCost' ? 1 : 0.5} value={Number(e.value)}
            onChange={(ev) => set({ value: Number(ev.target.value) || 0 })} />
        </label>
      </div>
    </>
  )
}

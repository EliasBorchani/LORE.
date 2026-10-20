import type { CasterLine, VariantLine } from 'dnd-engine'
import { useMemo, useState } from 'react'
import type { SpellVariant } from '../../api/types'
import { EntityName, InfoButton } from '../../components/EntityPanel'
import { StatBlock } from '../../components/grimoire'
import { formatNumber, splitDice, toInteger } from '../../format'
import { abilities, fr } from '../../i18n/fr'
import { slotsSpentAt } from '../../play/playState'
import { useSheet } from '../../sheet/SheetContext'
import { messageOf } from '../../useLoad'
import { Log } from './CombatTab'

const list = <T,>(kt: { asJsReadonlyArrayView(): ReadonlyArray<T> }) => kt.asJsReadonlyArrayView()

/** Spells per casting class: slots to spend, saved variants to cast, known spells, and the variant builder. */
export function MagicTab() {
  const { sheet, dispatch } = useSheet()
  const casters = list(sheet.spellcasting)
  if (casters.length === 0) return <p className="muted">{fr.sheet.magicNone}</p>
  return (
    <>
      <div className="block-head">
        <Log />
        <button className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'newDay' })}>{fr.sheet.newDay}</button>
      </div>
      {casters.map((caster) => <CasterSection key={caster.classId} caster={caster} />)}
    </>
  )
}

function CasterSection({ caster }: { caster: CasterLine }) {
  const { sheet, name, play, dispatch } = useSheet()
  const slots = list(caster.slots).map((s) => toInteger(s) ?? 0)
  const left = (level: number) => (slots[level] ?? 0) - slotsSpentAt(play, caster.classId, level)
  const spend = (level: number, label: string) =>
    dispatch({ type: 'spendSlot', classId: caster.classId, level, total: slots[level] ?? 0, label })
  const ability = abilities.find((a) => a.id === caster.ability)?.name ?? caster.ability
  const variants = list(sheet.variants).filter((v) => v.casterClass === caster.classId)
  // Paladins and rangers have no level 0 spells: their level 0 total is always 0.
  const firstLevel = slots[0] === 0 ? 1 : 0

  return (
    <>
      <StatBlock
        title={<EntityName id={caster.classId}>{name(caster.classId)}</EntityName>}
        subtitle={fr.magic.header(caster.casterLevel ?? '—', ability, fr.magic.modes[caster.mode] ?? caster.mode)}
        label={name(caster.classId)}
      >
        <h3 className="type-label-caps">{fr.magic.slots}</h3>
        <div className="slot-grid">
          {slots.map((total, level) => level >= firstLevel && (
            <button key={level} className="slot" disabled={left(level) <= 0}
              aria-label={fr.magic.slotAria(level, Math.max(left(level), 0), total)}
              onClick={() => spend(level, fr.magic.slotSpent)}>
              <span className="muted">{fr.magic.slotLabel(level)}</span>
              <strong>{Math.max(left(level), 0)}/{total}</strong>
            </button>
          ))}
        </div>
        <p className="muted">{fr.magic.dcs(list(caster.saveDcs).map((dc, level) => `${fr.magic.slotLabel(level)}\u00a0: ${dc}`).slice(firstLevel).join(' · '))}</p>
      </StatBlock>

      <section className="toggles" aria-label={fr.magic.ready}>
        <h2 className="type-heading">{fr.magic.ready}</h2>
        {variants.length === 0 && <p className="muted">{fr.magic.noVariant}</p>}
        {variants.map((v) => <VariantRow key={v.id} variant={v} left={left} spend={spend} />)}
      </section>

      <KnownSpells caster={caster} left={left} spend={spend} />
      <VariantBuilder caster={caster} />
    </>
  )
}

function VariantRow({ variant, left, spend }: { variant: VariantLine; left: (level: number) => number; spend: (level: number, label: string) => void }) {
  const { name, record, saveCharacter } = useSheet()
  const label = variantName(variant, name)
  const slotLevel = toInteger(variant.slotLevel)
  const canCast = slotLevel != null && left(slotLevel) > 0
  const remove = () =>
    void saveCharacter({ ...record.character, variants: (record.character.variants ?? []).filter((v) => v.id !== variant.id) })
  return (
    <div className="spell-row">
      <span className="toggle-text">
        <span className="toggle-name"><VariantName variant={variant} /></span>
        <span className="toggle-meta">{variantMeta(variant)}</span>
        {variant.slotLevel != null && slotLevel != null && !canCast && <span className="warning">{fr.magic.noSlot(slotLevel)}</span>}
        {slotLevel == null && <span className="warning">{fr.magic.notOnList}</span>}
      </span>
      <span className="spell-actions">
        <button className="btn btn-primary btn-small" disabled={!canCast} aria-label={slotLevel != null ? fr.magic.castAria(label, slotLevel) : label}
          onClick={() => slotLevel != null && spend(slotLevel, label)}>{fr.magic.cast}</button>
        <button className="btn btn-secondary btn-small" aria-label={fr.magic.remove(label)} onClick={remove}>×</button>
      </span>
    </div>
  )
}

function KnownSpells({ caster, left, spend }: { caster: CasterLine; left: (level: number) => number; spend: (level: number, label: string) => void }) {
  const { name } = useSheet()
  const levelOf = useSpellLevels(caster.classId)
  if (caster.mode === 'free_slots') return <p className="notice">{fr.magic.freeSlots}</p>
  const spells = list(caster.spells)
    .map((id) => ({ id, label: name(id), level: levelOf(id) }))
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.label.localeCompare(b.label, 'fr'))
  return (
    <section className="toggles" aria-label={caster.mode === 'prepared' ? fr.magic.spellbook : fr.magic.known}>
      <h2 className="type-heading">{caster.mode === 'prepared' ? fr.magic.spellbook : fr.magic.known}</h2>
      {spells.length === 0 && <p className="muted">{fr.magic.noSpells}</p>}
      {spells.map((s) => (
        <div key={s.id} className="spell-row">
          <span className="toggle-text">
            <span className="toggle-name"><EntityName id={s.id}>{s.label}</EntityName></span>
            <span className="toggle-meta">{s.level != null ? fr.magic.spellLevel(s.level) : fr.magic.notOnList}</span>
          </span>
          <button className="btn btn-primary btn-small" disabled={s.level == null || left(s.level) <= 0}
            aria-label={s.level != null ? fr.magic.castAria(s.label, s.level) : s.label}
            onClick={() => s.level != null && spend(s.level, s.label)}>{fr.magic.cast}</button>
        </div>
      ))}
    </section>
  )
}

function VariantBuilder({ caster }: { caster: CasterLine }) {
  const { sheet, name, entity, record, saveCharacter, closure } = useSheet()
  const levelOf = useSpellLevels(caster.classId)
  const [spell, setSpell] = useState('')
  const [metamagic, setMetamagic] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Choices: the spells the character knows; free-slot casters pick from the class list the catalog sent.
  const choices = useMemo(() => {
    const ids = caster.mode === 'free_slots'
      ? (closure.catalog.relations ?? []).filter((r) => r.relation === 'on_spell_list' && r.to === caster.classId).map((r) => r.from)
      : [...list(caster.spells)]
    return [...new Set(ids)].map((id) => ({ id, label: name(id), level: levelOf(id) })).sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [caster, closure, name, levelOf])

  // Metamagic the character has: feats whose spell-scoped effects cost slot levels.
  const owned = (record.character.levels ?? []).flatMap((l) => (l.feats ?? []).map((f) => f.id))
  const metamagicFeats = [...new Set(owned)].filter((id) =>
    entity(id)?.effects?.some((e) => e.scope === 'spell' && e.target === 'spell.slot_cost'),
  )

  const draft: SpellVariant | null = spell
    ? { id: `var.${spell.replace(/^spell\./, '')}.${metamagic.map((m) => m.replace(/^feat\./, '')).join('.') || 'plain'}`, spell, casterClass: caster.classId, metamagic }
    : null
  const preview = draft ? sheet.previewVariant(JSON.stringify(draft)) : null

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const others = (record.character.variants ?? []).filter((v) => v.id !== draft.id)
      await saveCharacter({ ...record.character, variants: [...others, draft] })
      setSpell('')
      setMetamagic([])
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="block">
      <summary className="block-title">{fr.magic.builder}</summary>
      {choices.length === 0 ? (
        <p className="muted">{fr.magic.builderNone}</p>
      ) : (
        <>
          <label className="field">
            <span>{fr.magic.builderSpell}</span>
            <select className="input" value={spell} onChange={(e) => setSpell(e.target.value)}>
              <option value="">{fr.magic.builderPick}</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>{c.label}{c.level != null ? ` (${fr.magic.spellLevel(c.level)})` : ''}</option>
              ))}
            </select>
          </label>
          <fieldset className="metamagic">
            <legend className="type-label-caps">{fr.magic.builderMetamagic}</legend>
            {metamagicFeats.length === 0 && <p className="muted">{fr.magic.builderNoMetamagic}</p>}
            {metamagicFeats.map((id) => (
              <label key={id} className="toggle-row">
                <span className="toggle-name">{name(id)}</span>
                <input type="checkbox" checked={metamagic.includes(id)}
                  onChange={(e) => setMetamagic(e.target.checked ? [...metamagic, id] : metamagic.filter((m) => m !== id))} />
                <InfoButton id={id} name={name(id)} />
              </label>
            ))}
          </fieldset>
          {preview && (
            <p aria-live="polite">
              <strong>{variantName(preview, name)}</strong> · {variantMeta(preview)}
            </p>
          )}
          {error && <p className="warning" role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={!draft || busy || preview?.slotLevel == null} onClick={save}>
            {fr.magic.builderSave}
          </button>
        </>
      )}
    </details>
  )
}

/** Spell id to its level on [classId]'s list, from the catalog the server sent. */
function useSpellLevels(classId: string): (spellId: string) => number | null {
  const { closure } = useSheet()
  return useMemo(() => {
    const levels = new Map(
      (closure.catalog.relations ?? [])
        .filter((r) => r.relation === 'on_spell_list' && r.to === classId && r.level != null)
        .map((r) => [r.from, r.level!]),
    )
    return (spellId: string) => levels.get(spellId) ?? null
  }, [closure, classId])
}

/** The spell and each metamagic feat, each opening its panel. */
function VariantName({ variant }: { variant: VariantLine }) {
  const { name } = useSheet()
  const ids = [variant.spell, ...list(variant.metamagic)]
  return ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ' · '}
      <EntityName id={id}>{name(id)}</EntityName>
    </span>
  ))
}

function variantName(variant: VariantLine, name: (id: string) => string): string {
  const metamagic = list(variant.metamagic).map(name)
  return metamagic.length ? `${name(variant.spell)} · ${metamagic.join(' · ')}` : name(variant.spell)
}

/** « emplacement niv. 4 · DD 15 · Soins 1d8 + 5 (~9) ». */
function variantMeta(variant: VariantLine): string {
  const numbers = list(variant.numbers).map((n) => {
    const dice = splitDice(n.text)
    const value = dice.average ? `${dice.expression} (~${dice.average})` : formatNumber(n.text)
    return `${fr.magic.numbers[n.key] ?? n.key} ${value}`
  })
  return [
    variant.slotLevel != null ? fr.magic.slotLevel(variant.slotLevel) : null,
    variant.saveDc != null ? fr.magic.dc(variant.saveDc) : null,
    ...numbers,
  ]
    .filter(Boolean)
    .join(' · ')
}

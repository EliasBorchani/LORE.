import { useState } from 'react'
import { Link } from 'react-router'
import { EntityName, InfoButton } from '../../components/EntityPanel'
import { StatBlock, StatTile, ToggleRow } from '../../components/grimoire'
import { formatModifier, formatNumber, formatThreatRange, splitDice, toInteger } from '../../format'
import { fr, statLabels } from '../../i18n/fr'
import { useSheet, type ToggleView } from '../../sheet/SheetContext'
import { AbilityTiles } from './AbilitiesTab'
import { useGroupPath } from '../../group/GroupContext'

export function CombatTab() {
  return (
    <div className="sheet-grid">
      <div className="sheet-aside">
        <HitPoints />
        <Defenses />
        <div className="wide-only">
          <AbilityTiles />
        </div>
      </div>
      <div className="sheet-body">
        <Weapon />
        <Effects />
        <DailyUses />
      </div>
    </div>
  )
}

function HitPoints() {
  const { stat, play, dispatch } = useSheet()
  const [amount, setAmount] = useState('')
  const hpMax = toInteger(stat('hp.max')) ?? 0
  const tempLeft = Math.max((toInteger(stat('hp.temporary')) ?? 0) - play.tempHpLost, 0)
  const hpNow = hpMax - play.damage
  const percent = hpMax > 0 ? Math.max(0, Math.min(100, Math.round((hpNow / hpMax) * 100))) : 0
  const n = Number.parseInt(amount, 10)
  const valid = Number.isFinite(n) && n > 0

  const act = (type: 'hurt' | 'heal') => {
    if (!valid) return
    dispatch(type === 'hurt' ? { type, amount: n, tempAvailable: tempLeft } : { type, amount: n })
    setAmount('')
  }

  return (
    <StatBlock title={fr.sheet.hp} label={fr.sheet.hp} aside={<span className="muted">{fr.sheet.hpMax(formatNumber(String(hpMax)))}</span>}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span className="hp-now" aria-live="polite" style={{ color: percent <= 25 ? 'var(--warning)' : undefined }}>
          {formatNumber(String(hpNow))}
        </span>
        {tempLeft > 0 && <span className="gilt">{fr.sheet.temp(formatNumber(String(tempLeft)))}</span>}
      </div>
      <div className="hp-bar" aria-hidden="true">
        <div style={{ width: `${percent}%` }} />
      </div>
      <form className="hp-actions" onSubmit={(e) => { e.preventDefault(); act('hurt') }}>
        <label className="field">
          <span className="visually-hidden">{fr.sheet.amount}</span>
          <input className="input" type="number" inputMode="numeric" min="1" placeholder={fr.sheet.amount}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={!valid}>{fr.sheet.hurt}</button>
        <button className="btn btn-secondary" type="button" disabled={!valid} onClick={() => act('heal')}>{fr.sheet.heal}</button>
      </form>
      <Log />
    </StatBlock>
  )
}

export function Log() {
  const { play, dispatch } = useSheet()
  const last = play.log.at(-1)
  return (
    <div className="hp-log">
      <span aria-live="polite">{last?.text ?? fr.sheet.logHint}</span>
      {last && (
        <button className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'undo' })}>
          {fr.sheet.undo}
        </button>
      )}
    </div>
  )
}

function Defenses() {
  const groupPath = useGroupPath()
  const { stat, record } = useSheet()
  const to = (key: string) => groupPath(`/characters/${record.id}/stat/${key}`)
  const initiative = stat('initiative')
  const tiles = [
    { key: 'ac.total', label: 'CA', modifier: false },
    { key: 'bab', label: 'BBA', modifier: false },
    { key: 'spell_resistance', label: 'RM', modifier: false },
    { key: 'save.ref', label: statLabels['save.ref'], modifier: true },
    { key: 'save.fort', label: statLabels['save.fort'], modifier: true },
    { key: 'save.will', label: statLabels['save.will'], modifier: true },
  ]
  return (
    <section className="tiles" aria-label={fr.sheet.tabs.combat}>
      {tiles.map((t) => {
        const value = stat(t.key)
        if (value == null) return null
        return <StatTile key={t.key} value={t.modifier ? formatModifier(value) : formatNumber(value)} label={t.label} to={to(t.key)} />
      })}
      {initiative != null && (
        <Link className="tile tile-row" to={to('initiative')} aria-label={fr.sheet.seeBreakdown(statLabels.initiative)}>
          <span>{fr.sheet.initiative}</span>
          <span className="type-stat-m">{formatModifier(initiative)}</span>
        </Link>
      )}
    </section>
  )
}

function Weapon() {
  const groupPath = useGroupPath()
  const { stat, record, name, entity } = useSheet()
  const attack = stat('attack.melee')
  const ranged = stat('attack.ranged')
  const damage = stat('damage.melee')
  if (attack == null && damage == null) return null
  // The engine applies item-scoped effects to one wielded weapon: the equipped item that has some.
  const weapon = record.character.items?.find(
    (i) => i.equipped !== false && entity(i.id)?.effects?.some((e) => e.scope === 'item'),
  )
  const dice = damage ? splitDice(damage) : null
  const threat = stat('weapon.threat_range')
  const multiplier = stat('weapon.crit_multiplier')
  const to = (key: string) => groupPath(`/characters/${record.id}/stat/${key}`)
  return (
    <StatBlock title={weapon ? <EntityName id={weapon.id}>{name(weapon.id)}</EntityName> : fr.sheet.weapon} label={fr.sheet.weapon}>
      <div className="weapon-nums">
        {attack != null && (
          <Link className="weapon-num" to={to('attack.melee')} aria-label={fr.sheet.seeBreakdown(statLabels['attack.melee'])}>
            <span className="lab">{fr.sheet.attackMelee}</span>
            <span className="xl">{formatModifier(attack)}</span>
          </Link>
        )}
        {ranged != null && (
          <Link className="weapon-num" to={to('attack.ranged')} aria-label={fr.sheet.seeBreakdown(statLabels['attack.ranged'])}>
            <span className="lab">{fr.sheet.attackRanged}</span>
            <span className="xl">{formatModifier(ranged)}</span>
          </Link>
        )}
        {dice && (
          <Link className="weapon-num" to={to('damage.melee')} aria-label={fr.sheet.seeBreakdown(statLabels['damage.melee'])}>
            <span className="lab">{fr.sheet.damage}</span>
            <span className="m">{dice.expression}</span>
            {dice.average && <span className="gilt">~{dice.average}</span>}
          </Link>
        )}
      </div>
      {threat && multiplier && <span>{fr.sheet.critical(formatThreatRange(threat), multiplier)}</span>}
    </StatBlock>
  )
}

function Effects() {
  const { toggles } = useSheet()
  const active = toggles.filter((t) => t.active).length
  return (
    <section className="toggles" aria-label={fr.sheet.effects}>
      <div className="block-head">
        <h2 className="type-heading">{fr.sheet.effects}</h2>
        <span className="muted">{fr.sheet.activeCount(active)}</span>
      </div>
      {toggles.map((t) => (
        <EffectRow key={t.id} toggle={t} />
      ))}
    </section>
  )
}

function EffectRow({ toggle }: { toggle: ToggleView }) {
  const { name, setToggle, setToggleValue, stat } = useSheet()
  const label = toggle.source ? name(toggle.source) : toggle.id
  const metamagic = (toggle.choice.metamagic ?? []).map(name).join(' · ')
  const value = toInteger(String(toggle.choice.value ?? '')) ?? 1
  const maxValue = Math.max(toggle.maxValue ?? toInteger(stat('bab')) ?? 1, 1)

  const switchTo = (on: boolean) => {
    // A toggle carrying a value starts at 1: with none, the engine would read 0 and the toggle would do nothing.
    const choice = on && toggle.takesValue && toggle.choice.value == null ? { ...toggle.choice, value: '1' } : toggle.choice
    setToggle({ ...toggle, choice }, on)
  }

  return (
    <ToggleRow name={label} meta={toggle.active ? metamagic : fr.sheet.effectOff} on={toggle.active} onChange={switchTo}
      info={toggle.source && <InfoButton id={toggle.source} name={label} />}>
      {toggle.active && toggle.takesValue && (
        <div className="toggle-value">
          <span>{fr.sheet.toggleValue}</span>
          <span className="stepper">
            <button type="button" aria-label={fr.sheet.less} disabled={value <= 1}
              onClick={() => setToggleValue(toggle.id, String(value - 1))}>−</button>
            <output aria-live="polite">{value}</output>
            <button type="button" aria-label={fr.sheet.more} disabled={value >= maxValue}
              onClick={() => setToggleValue(toggle.id, String(value + 1))}>+</button>
          </span>
        </div>
      )}
    </ToggleRow>
  )
}

function DailyUses() {
  const { dailyUses, play, name, dispatch } = useSheet()
  if (dailyUses.length === 0) return null
  return (
    <StatBlock title={fr.sheet.powers} label={fr.sheet.powers}
      aside={<button className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'newDay' })}>{fr.sheet.newDay}</button>}>
      {dailyUses.map((u) => {
        const used = play.usesSpent[u.entity] ?? 0
        const label = name(u.entity)
        return (
          <div className="power-row" key={u.entity}>
            <span className="list-row-text">
              <EntityName id={u.entity}>{label}</EntityName>
              <span className="muted">{fr.sheet.usesLeft(u.max - used, u.max)}</span>
            </span>
            <span className="pips">
              {Array.from({ length: u.max }, (_, i) => {
                const spent = i < used
                return (
                  <button key={i} className="pip" aria-pressed={spent} aria-label={fr.sheet.use(label, i + 1, u.max, spent)}
                    onClick={() => dispatch({ type: 'setUsed', entity: u.entity, name: label, used: spent ? i : i + 1, max: u.max })}>
                    <span />
                  </button>
                )
              })}
            </span>
          </div>
        )
      })}
    </StatBlock>
  )
}
